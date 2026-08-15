import { EVENT_TYPES, type AnyMarketplaceEvent } from "../domain/events.js";
import { AppError } from "../domain/errors.js";
import { parseMarketplaceMessage } from "../domain/schemas.js";

export type ReplayPage = {
  status: "success";
  events: AnyMarketplaceEvent[];
  nextAfter: string | null;
};

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ReplayClientOptions = {
  endpoint: string;
  fetch?: FetchLike;
  limit?: number;
  timeoutMs?: number;
};

export class CursorExpiredError extends AppError {
  constructor(after: string) {
    super(
      "CURSOR_EXPIRED",
      "The upstream replay cursor is missing or older than retention.",
      {
        details: { after },
        retryable: false,
      },
    );
  }
}

export class ReplayRateLimitedError extends AppError {
  constructor() {
    super(
      "REPLAY_RATE_LIMITED",
      "The upstream replay endpoint rate-limited this collector.",
      {
        retryable: true,
      },
    );
  }
}

function clampLimit(limit: number): number {
  if (!Number.isInteger(limit)) return 100;
  return Math.min(500, Math.max(1, limit));
}

export class ReplayClient {
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly limit: number;
  private readonly timeoutMs: number;

  constructor(options: ReplayClientOptions) {
    this.endpoint = options.endpoint;
    this.fetchImpl = options.fetch ?? fetch;
    this.limit = clampLimit(options.limit ?? 500);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async fetchPage(
    options: {
      after?: string;
      types?: string[];
      signal?: AbortSignal;
    } = {},
  ): Promise<ReplayPage> {
    const url = new URL(this.endpoint);
    url.searchParams.set("limit", String(this.limit));
    if (options.after) url.searchParams.set("after", options.after);
    if (options.types && options.types.length > 0) {
      const invalid = options.types.filter(
        (type) => !(EVENT_TYPES as readonly string[]).includes(type),
      );
      if (invalid.length > 0) {
        throw new AppError(
          "INVALID_ARGUMENT",
          "Replay event type filter contains an unknown type.",
          {
            details: { invalid },
          },
        );
      }
      url.searchParams.set(
        "types",
        [...new Set(options.types)].sort().join(","),
      );
    }

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const signal = mergeSignals(options.signal, timeout.signal);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: "GET", signal });
    } catch (error) {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "Unable to reach the marketplace replay endpoint.",
        {
          cause: error,
          retryable: true,
        },
      );
    } finally {
      clearTimeout(timer);
    }

    const bodyText = await response.text();
    if (
      response.status === 400 &&
      /invalid or expired after cursor/iu.test(bodyText)
    ) {
      throw new CursorExpiredError(options.after ?? "");
    }
    if (response.status === 429) throw new ReplayRateLimitedError();
    if (!response.ok) {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        `Replay endpoint returned HTTP ${response.status}.`,
        {
          details: { status: response.status },
          retryable: response.status >= 500,
        },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch (error) {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "Replay endpoint returned invalid JSON.",
        { cause: error },
      );
    }
    if (
      !isRecord(body) ||
      body.status !== "success" ||
      !Array.isArray(body.events)
    ) {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "Replay endpoint returned an invalid page shape.",
      );
    }

    const events: AnyMarketplaceEvent[] = [];
    for (const rawEvent of body.events) {
      const parsed = parseMarketplaceMessage(rawEvent);
      if (parsed.kind === "event") events.push(parsed.event);
    }
    const nextAfter =
      body.nextAfter === null || typeof body.nextAfter === "string"
        ? body.nextAfter
        : undefined;
    if (nextAfter === undefined) {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "Replay endpoint omitted nextAfter.",
      );
    }
    return { status: "success", events, nextAfter };
  }

  async replayAll(
    after: string | undefined,
    onPage: (
      page: ReplayPage,
      cursorUsed: string | undefined,
    ) => Promise<void> | void,
    options: { types?: string[]; signal?: AbortSignal } = {},
  ): Promise<{ pages: number; events: number; nextAfter: string | null }> {
    let cursor = after;
    let pages = 0;
    let events = 0;
    while (true) {
      const page = await this.fetchPage({
        ...(cursor ? { after: cursor } : {}),
        ...(options.types ? { types: options.types } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      await onPage(page, cursor);
      pages += 1;
      events += page.events.length;
      if (page.events.length < this.limit) {
        return { pages, events, nextAfter: page.nextAfter };
      }
      if (!page.nextAfter) {
        throw new AppError(
          "UPSTREAM_UNAVAILABLE",
          "Replay page was full but had no continuation cursor.",
        );
      }
      cursor = page.nextAfter;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeSignals(
  first: AbortSignal | undefined,
  second: AbortSignal,
): AbortSignal {
  if (!first) return second;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (first.aborted || second.aborted) controller.abort();
  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
