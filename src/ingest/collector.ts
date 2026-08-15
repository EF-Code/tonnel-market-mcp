import { randomUUID } from "node:crypto";

import WebSocket, { type RawData } from "ws";

import type { AlertEngine } from "../alerts/engine.js";
import type { AppConfig } from "../config.js";
import {
  isKnownEventType,
  type AnyMarketplaceEvent,
  type ReceiveContext,
} from "../domain/events.js";
import { AppError, isAppError } from "../domain/errors.js";
import { createLogger, type Logger } from "../observability/logger.js";
import { ExponentialBackoff, sleepWithSignal } from "./backoff.js";
import { CursorExpiredError, ReplayClient } from "./replay.js";
import { CoverageRepository } from "../storage/coverage-repository.js";
import { DatabaseManager } from "../storage/database.js";
import {
  EventRepository,
  type EventSource,
} from "../storage/event-repository.js";
import { ProjectionRepository } from "../storage/projection-repository.js";
import { parseMarketplaceMessage } from "../domain/schemas.js";

type SocketLike = {
  on(event: "open", listener: () => void): SocketLike;
  on(event: "message", listener: (data: RawData) => void): SocketLike;
  on(
    event: "close",
    listener: (code: number, reason: Buffer) => void,
  ): SocketLike;
  on(event: "error", listener: (error: Error) => void): SocketLike;
  close(code?: number, reason?: string): void;
};

export type CollectorOptions = {
  config: Pick<AppConfig, "websocketUrl">;
  database: DatabaseManager;
  events: EventRepository;
  projections: ProjectionRepository;
  coverage: CoverageRepository;
  replay: ReplayClient;
  alertEngine?: AlertEngine;
  logger?: Logger;
  now?: () => string;
  websocketFactory?: (url: string) => SocketLike;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  backoff?: ExponentialBackoff;
};

type BufferedEvent = {
  event: AnyMarketplaceEvent;
  receivedAt: string;
  receiveSequence: number;
};

export class MarketplaceCollector {
  private readonly logger: Logger;
  private readonly now: () => string;
  private readonly websocketFactory: (url: string) => SocketLike;
  private readonly sleep: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  private readonly backoff: ExponentialBackoff;
  private readonly stopController = new AbortController();
  private activeSocket: SocketLike | undefined;
  private receiveSequence = 0;

  constructor(private readonly options: CollectorOptions) {
    this.logger = options.logger ?? createLogger("info");
    this.now = options.now ?? (() => new Date().toISOString());
    this.websocketFactory =
      options.websocketFactory ?? ((url) => new WebSocket(url));
    this.sleep = options.sleep ?? sleepWithSignal;
    this.backoff = options.backoff ?? new ExponentialBackoff();
    this.options.events.initializeCollector(this.now());
  }

  async run(signal?: AbortSignal): Promise<void> {
    const combinedSignal = mergeSignals(signal, this.stopController.signal);
    while (!combinedSignal.aborted) {
      this.options.events.setWebsocketState("connecting", this.now());
      try {
        await this.connectAndRecover(combinedSignal);
        this.backoff.reset();
      } catch (error) {
        if (combinedSignal.aborted) break;
        this.logger.warn("collector connection cycle failed", {
          code: isAppError(error) ? error.code : "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      if (combinedSignal.aborted) break;
      const delay = this.backoff.nextDelay();
      this.options.events.setWebsocketState("backoff", this.now());
      await this.sleep(delay, combinedSignal);
    }
    this.options.events.setWebsocketState("stopped", this.now());
  }

  stop(): void {
    this.stopController.abort();
    this.activeSocket?.close(1000, "collector stopped");
    this.activeSocket = undefined;
  }

  private async connectAndRecover(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const socket = this.websocketFactory(this.options.config.websocketUrl);
    this.activeSocket = socket;

    await new Promise<void>((resolve, reject) => {
      let opened = false;
      let replaying = true;
      let failure: unknown;
      const buffered: BufferedEvent[] = [];
      let settled = false;

      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        this.activeSocket = undefined;
        if (error) reject(error);
        else resolve();
      };

      const fail = (error: unknown) => {
        failure = error;
        try {
          socket.close(1013, "recovery failed");
        } catch {
          finish(error);
        }
      };

      socket.on("open", () => {
        opened = true;
        this.options.events.setWebsocketState("buffering", this.now());
        void this.recover(signal, buffered)
          .then(() => {
            replaying = false;
            this.options.events.setWebsocketState("connected", this.now());
          })
          .catch(fail);
      });

      socket.on("message", (raw) => {
        const receivedAt = this.now();
        const receiveSequence = ++this.receiveSequence;
        let parsed;
        try {
          parsed = parseMarketplaceMessage(rawToString(raw));
        } catch (error) {
          this.options.events.recordProcessingError(error);
          this.logger.warn("ignored invalid upstream message", {
            code: isAppError(error) ? error.code : "INVALID_ARGUMENT",
          });
          return;
        }
        if (parsed.kind === "connected") {
          this.options.events.setServerTime(
            parsed.message.serverTime,
            receivedAt,
          );
          return;
        }
        if (parsed.kind !== "event") return;
        this.options.events.markReceived(receivedAt);
        if (replaying) {
          buffered.push({ event: parsed.event, receivedAt, receiveSequence });
          return;
        }
        try {
          this.processEvent(parsed.event, {
            source: "websocket",
            receivedAt,
            receiveSequence,
            correlationId: randomUUID(),
          });
        } catch (error) {
          this.logger.warn("live event processing failed", {
            eventId: parsed.event.eventId,
            code: isAppError(error) ? error.code : "INTERNAL_ERROR",
          });
        }
      });

      socket.on("error", (error) => {
        if (!opened)
          fail(
            new AppError(
              "UPSTREAM_UNAVAILABLE",
              "Marketplace WebSocket connection failed.",
              { cause: error, retryable: true },
            ),
          );
        else
          this.logger.warn("marketplace WebSocket error", {
            message: error.message,
          });
      });

      socket.on("close", (code, reason) => {
        if (failure) {
          finish(failure);
          return;
        }
        if (!opened && !signal.aborted) {
          finish(
            new AppError(
              "UPSTREAM_UNAVAILABLE",
              "Marketplace WebSocket closed before opening.",
              { details: { code }, retryable: true },
            ),
          );
          return;
        }
        if (!signal.aborted) {
          this.logger.info("marketplace WebSocket disconnected", {
            code,
            reason: reason.toString().slice(0, 100),
          });
        }
        finish();
      });

      signal.addEventListener(
        "abort",
        () => {
          try {
            socket.close(1000, "collector stopped");
          } finally {
            finish();
          }
        },
        { once: true },
      );
    });
  }

  private async recover(
    signal: AbortSignal,
    buffered: BufferedEvent[],
  ): Promise<void> {
    const checkpoint = this.options.events.getCheckpoint();
    const cursor = checkpoint?.eventId;
    this.options.events.setReplayState("running", this.now());

    const processReplay = async (after: string | undefined) => {
      await this.options.replay.replayAll(
        after,
        async (page) => {
          for (const event of page.events) {
            this.processEvent(event, {
              source: "replay",
              receivedAt: this.now(),
              receiveSequence: ++this.receiveSequence,
              correlationId: randomUUID(),
            });
          }
          this.recordAvailableCoverage(page.events);
        },
        { signal },
      );
    };

    try {
      await processReplay(cursor);
    } catch (error) {
      if (!(error instanceof CursorExpiredError) || !cursor) {
        this.options.events.setReplayState("failed", this.now());
        throw error;
      }
      this.options.events.recordCursorExpiry(this.now());
      this.options.coverage.record(
        "gap",
        {
          ...(checkpoint?.occurredAt ? { from: checkpoint.occurredAt } : {}),
          to: this.now(),
        },
        "The upstream seven-day replay cursor expired; continuity before the restart cannot be proven.",
        "replay",
        this.now(),
      );
      await processReplay(undefined);
    }

    this.options.events.setReplayState("completed", this.now());
    buffered.sort((left, right) => {
      const occurred = left.event.occurredAt.localeCompare(
        right.event.occurredAt,
      );
      return occurred !== 0
        ? occurred
        : left.receiveSequence - right.receiveSequence;
    });
    for (const item of buffered) {
      this.processEvent(item.event, {
        source: "websocket",
        receivedAt: item.receivedAt,
        receiveSequence: item.receiveSequence,
        correlationId: randomUUID(),
      });
    }
  }

  private processEvent(
    event: AnyMarketplaceEvent,
    context: ReceiveContext & { source: EventSource; correlationId: string },
  ): void {
    const result = this.options.events.processEvent(event, context, (db) => {
      this.options.projections.apply(db, event);
      this.options.alertEngine?.evaluate(db, event, this.now());
    });
    if (result.unknown) {
      this.logger.debug("checkpointed unknown marketplace event", {
        eventId: event.eventId,
        type: event.type,
      });
    }
  }

  private recordAvailableCoverage(events: AnyMarketplaceEvent[]): void {
    if (events.length === 0) return;
    const first = events[0];
    const last = events.at(-1);
    if (!first || !last) return;
    this.options.coverage.record(
      "available",
      { from: first.occurredAt, to: last.occurredAt },
      "Events were successfully processed from the upstream seven-day replay window.",
      "replay",
      this.now(),
    );
  }
}

function rawToString(raw: RawData): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
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
