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
  complete: boolean;
  mode: "partial" | "seven_day_replay_baseline" | "full_snapshot";
  gaps: Array<{ from?: string; to?: string; reason: string }>;
  collectorStartedAt: string;
  lastCheckpoint?: string;
  fullSnapshot: boolean;
};

export class CoverageService {
  constructor(
    private readonly coverage: CoverageRepository,
    private readonly events: EventRepository,
    private readonly database: DatabaseManager,
  ) {}

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
    const coversRequested =
      (!requested.from || !availableFrom || availableFrom <= requested.from) &&
      (!requested.to || !availableTo || availableTo >= requested.to);
    const complete = state.fullSnapshot && coversRequested && gaps.length === 0;
    return {
      ...(requested.from ? { requestedFrom: requested.from } : {}),
      ...(requested.to ? { requestedTo: requested.to } : {}),
      ...(availableFrom ? { availableFrom } : {}),
      ...(availableTo ? { availableTo } : {}),
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
    if (!envelope.complete)
      warnings.push(
        "Observed listings and floors must not be treated as complete marketplace state.",
      );
    return warnings;
  }

  migrationVersion(): number {
    return this.database.currentMigrationVersion();
  }
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
