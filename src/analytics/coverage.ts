import type {
  CoverageInterval,
  CoverageRepository,
} from "../storage/coverage-repository.js";
import type { DatabaseManager } from "../storage/database.js";
import type { EventRepository } from "../storage/event-repository.js";

export type CoverageEnvelope = {
  requestedFrom?: string;
  requestedTo?: string;
  availableFrom?: string;
  availableTo?: string;
  stream: {
    current: boolean;
    availableFrom?: string;
    availableTo?: string;
  };
  requestedWindowCovered?: boolean;
  complete: boolean;
  mode: "partial" | "seven_day_replay_baseline" | "full_snapshot";
  gaps: Array<{ from?: string; to?: string; reason: string }>;
  collectorStartedAt: string;
  lastCheckpoint?: string;
  fullSnapshot: boolean;
};

export type CoverageWaitResult = {
  ready: boolean;
  waitedMs: number;
  coverage: CoverageEnvelope;
};

export type CoverageServiceOptions = {
  now?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class CoverageService {
  constructor(
    private readonly coverage: CoverageRepository,
    private readonly events: EventRepository,
    private readonly database: DatabaseManager,
    options: CoverageServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.sleep = options.sleep ?? sleep;
  }

  private readonly now: () => string;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  get(requested: { from?: string; to?: string } = {}): CoverageEnvelope {
    const intervals = this.coverage.list();
    const state = this.events.getHealthState();
    const available = intervals.filter(
      (interval) => interval.kind === "available",
    );
    const gaps = intervals.filter(
      (interval) => interval.kind === "gap" && overlaps(interval, requested),
    );
    const availableFrom = minBoundary(available, "from");
    const availableTo = maxBoundary(available, "to");
    const streamCurrent =
      state.replayState === "completed" && state.websocketState === "connected";
    const stream = {
      current: streamCurrent,
      ...(streamCurrent && state.lastReplayCompletedAt
        ? { availableFrom: state.lastReplayCompletedAt }
        : {}),
      ...(streamCurrent ? { availableTo: this.now() } : {}),
    };
    const requestedWindowCovered =
      requested.from !== undefined || requested.to !== undefined
        ? coversWindow(
            requested,
            {
              ...(availableFrom ? { from: availableFrom } : {}),
              ...(availableTo ? { to: availableTo } : {}),
            },
            stream,
            gaps.length === 0,
          )
        : undefined;
    const complete =
      state.fullSnapshot &&
      (requestedWindowCovered ?? gaps.length === 0) &&
      gaps.length === 0;
    return {
      ...(requested.from ? { requestedFrom: requested.from } : {}),
      ...(requested.to ? { requestedTo: requested.to } : {}),
      ...(availableFrom ? { availableFrom } : {}),
      ...(availableTo ? { availableTo } : {}),
      stream,
      ...(requestedWindowCovered !== undefined
        ? { requestedWindowCovered }
        : {}),
      complete,
      mode: state.fullSnapshot
        ? "full_snapshot"
        : available.length > 0
          ? "seven_day_replay_baseline"
          : "partial",
      gaps: gaps.map((gap) => ({
        ...(gap.from ? { from: gap.from } : {}),
        ...(gap.to ? { to: gap.to } : {}),
        reason: gap.reason,
      })),
      collectorStartedAt: state.collectorStartedAt,
      ...(state.lastCommittedEventId
        ? { lastCheckpoint: state.lastCommittedEventId }
        : {}),
      fullSnapshot: state.fullSnapshot,
    };
  }

  warnings(envelope: CoverageEnvelope): string[] {
    const warnings: string[] = [];
    if (!envelope.fullSnapshot) {
      warnings.push(
        "The upstream API retains seven days of events but does not provide a complete active-market snapshot.",
      );
    }
    if (envelope.mode === "partial")
      warnings.push(
        "The collector has not established a replay availability interval yet.",
      );
    if (envelope.gaps.length > 0)
      warnings.push(
        "One or more replay or processing gaps overlap the requested interval.",
      );
    if (envelope.requestedWindowCovered === false)
      warnings.push(
        "The collector has not reached the requested time window; an empty result is provisional. Wait for replayState=completed and websocketState=connected, then retry.",
      );
    if (!envelope.complete)
      warnings.push(
        "Observed listings and floors must not be treated as complete marketplace state.",
      );
    return warnings;
  }

  async waitForWindow(
    requested: { from?: string; to?: string },
    timeoutMs: number,
  ): Promise<CoverageWaitResult> {
    const startedAt = Date.now();
    const boundedTimeout = Math.max(0, Math.floor(timeoutMs));
    while (true) {
      const coverage = this.get(requested);
      if (coverage.requestedWindowCovered === true) {
        return {
          ready: true,
          waitedMs: Date.now() - startedAt,
          coverage,
        };
      }
      const remaining = boundedTimeout - (Date.now() - startedAt);
      if (remaining <= 0) {
        return {
          ready: false,
          waitedMs: Date.now() - startedAt,
          coverage,
        };
      }
      await this.sleep(Math.min(250, remaining));
    }
  }

  migrationVersion(): number {
    return this.database.currentMigrationVersion();
  }
}

function coversWindow(
  requested: { from?: string; to?: string },
  available: { from?: string; to?: string },
  stream: { current: boolean; availableFrom?: string; availableTo?: string },
  gapFree: boolean,
): boolean {
  if (!gapFree) return false;
  const fromCovered =
    requested.from === undefined ||
    (available.from !== undefined && available.from <= requested.from) ||
    (stream.current &&
      stream.availableFrom !== undefined &&
      stream.availableFrom <= requested.from);
  const toCovered =
    requested.to === undefined ||
    (available.to !== undefined && available.to >= requested.to) ||
    (stream.current &&
      stream.availableTo !== undefined &&
      stream.availableTo >= requested.to);
  return fromCovered && toCovered;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function overlaps(
  interval: CoverageInterval,
  requested: { from?: string; to?: string },
): boolean {
  if (requested.from && interval.to && interval.to < requested.from)
    return false;
  if (requested.to && interval.from && interval.from > requested.to)
    return false;
  return true;
}

function minBoundary(
  intervals: CoverageInterval[],
  key: "from" | "to",
): string | undefined {
  const values = intervals.flatMap((interval) =>
    interval[key] ? [interval[key] as string] : [],
  );
  return values.sort()[0];
}

function maxBoundary(
  intervals: CoverageInterval[],
  key: "from" | "to",
): string | undefined {
  const values = intervals.flatMap((interval) =>
    interval[key] ? [interval[key] as string] : [],
  );
  return values.sort().at(-1);
}
