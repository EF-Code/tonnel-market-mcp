import {
  isKnownEventType,
  type AnyMarketplaceEvent,
  type ReceiveContext,
} from "../domain/events.js";
import { AppError } from "../domain/errors.js";
import type { DatabaseManager, SqliteDatabase } from "./database.js";

export type EventSource = "replay" | "websocket" | "manual";

export type ProcessEventOptions = ReceiveContext & {
  source: EventSource;
  correlationId: string;
};

export type ProcessEventResult = {
  accepted: boolean;
  duplicate: boolean;
  unknown: boolean;
};

export type Checkpoint = {
  eventId: string;
  occurredAt: string;
  committedAt: string;
  source: EventSource;
};

export type CollectorHealthState = {
  collectorStartedAt: string;
  websocketState:
    "idle" | "connecting" | "buffering" | "connected" | "backoff" | "stopped";
  lastServerTime?: string;
  lastReceivedAt?: string;
  lastCommittedEventId?: string;
  lastCommittedAt?: string;
  replayState: "idle" | "running" | "expired_cursor" | "failed" | "completed";
  lastReplayStartedAt?: string;
  lastReplayCompletedAt?: string;
  duplicateCount: number;
  unknownEventCount: number;
  processingErrorCount: number;
  cursorExpiryCount: number;
  fullSnapshot: boolean;
  updatedAt: string;
};

type RawStatusRow = { processing_status: "processed" | "failed" };
type StateRow = {
  collector_started_at: string;
  websocket_state: CollectorHealthState["websocketState"];
  last_server_time: string | null;
  last_received_at: string | null;
  last_committed_event_id: string | null;
  last_committed_at: string | null;
  replay_state: CollectorHealthState["replayState"];
  last_replay_started_at: string | null;
  last_replay_completed_at: string | null;
  duplicate_count: number;
  unknown_event_count: number;
  processing_error_count: number;
  cursor_expiry_count: number;
  full_snapshot: number;
  updated_at: string;
};

export class EventRepository {
  private readonly db: SqliteDatabase;

  constructor(private readonly database: DatabaseManager) {
    this.db = database.db;
  }

  initializeCollector(startedAt = new Date().toISOString()): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO collector_state
         (id, collector_started_at, websocket_state, replay_state, updated_at)
         VALUES (1, ?, 'idle', 'idle', ?)`,
      )
      .run(startedAt, startedAt);
  }

  processEvent(
    event: AnyMarketplaceEvent,
    options: ProcessEventOptions,
    project: (db: SqliteDatabase) => void,
  ): ProcessEventResult {
    const existing = this.db
      .prepare("SELECT processing_status FROM raw_events WHERE event_id = ?")
      .get(event.eventId) as RawStatusRow | undefined;
    if (existing?.processing_status === "processed") {
      this.incrementCounter("duplicate_count");
      return {
        accepted: false,
        duplicate: true,
        unknown: !isKnownEventType(event.type),
      };
    }

    const processedAt = new Date().toISOString();
    try {
      this.database.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO raw_events
             (event_id, version, type, occurred_at, received_at, receive_sequence,
              raw_payload, processing_status, correlation_id, processed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?, NULL)
             ON CONFLICT(event_id) DO UPDATE SET
              version = excluded.version,
              type = excluded.type,
              occurred_at = excluded.occurred_at,
              received_at = excluded.received_at,
              receive_sequence = excluded.receive_sequence,
              raw_payload = excluded.raw_payload,
              processing_status = 'failed',
              correlation_id = excluded.correlation_id,
              error_code = NULL,
              error_message = NULL`,
          )
          .run(
            event.eventId,
            event.version,
            event.type,
            event.occurredAt,
            options.receivedAt,
            options.receiveSequence,
            JSON.stringify(event),
            options.correlationId,
          );

        project(this.db);

        this.db
          .prepare(
            `UPDATE raw_events
             SET processing_status = 'processed', processed_at = ?, error_code = NULL, error_message = NULL
             WHERE event_id = ?`,
          )
          .run(processedAt, event.eventId);

        this.db
          .prepare(
            `INSERT INTO checkpoints (name, event_id, occurred_at, committed_at, source)
             VALUES ('marketplace', ?, ?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET
               event_id = excluded.event_id,
               occurred_at = excluded.occurred_at,
               committed_at = excluded.committed_at,
               source = excluded.source`,
          )
          .run(event.eventId, event.occurredAt, processedAt, options.source);

        this.db
          .prepare(
            `UPDATE collector_state
             SET last_received_at = ?, last_committed_event_id = ?, last_committed_at = ?,
                 unknown_event_count = unknown_event_count + ?, updated_at = ?
             WHERE id = 1`,
          )
          .run(
            options.receivedAt,
            event.eventId,
            processedAt,
            isKnownEventType(event.type) ? 0 : 1,
            processedAt,
          );
      });
    } catch (error) {
      this.recordFailure(event, options, error);
      throw error instanceof AppError
        ? error
        : new AppError(
            "DATABASE_UNAVAILABLE",
            "Marketplace event transaction failed.",
            {
              cause: error,
              retryable: true,
            },
          );
    }

    return {
      accepted: true,
      duplicate: false,
      unknown: !isKnownEventType(event.type),
    };
  }

  getCheckpoint(): Checkpoint | undefined {
    const row = this.db
      .prepare(
        `SELECT event_id, occurred_at, committed_at, source
         FROM checkpoints WHERE name = 'marketplace'`,
      )
      .get() as
      | {
          event_id: string;
          occurred_at: string;
          committed_at: string;
          source: EventSource;
        }
      | undefined;
    return row
      ? {
          eventId: row.event_id,
          occurredAt: row.occurred_at,
          committedAt: row.committed_at,
          source: row.source,
        }
      : undefined;
  }

  markReceived(receivedAt: string): void {
    this.db
      .prepare(
        "UPDATE collector_state SET last_received_at = ?, updated_at = ? WHERE id = 1",
      )
      .run(receivedAt, receivedAt);
  }

  setWebsocketState(
    state: CollectorHealthState["websocketState"],
    updatedAt = new Date().toISOString(),
  ): void {
    this.db
      .prepare(
        "UPDATE collector_state SET websocket_state = ?, updated_at = ? WHERE id = 1",
      )
      .run(state, updatedAt);
  }

  setReplayState(
    state: CollectorHealthState["replayState"],
    timestamp = new Date().toISOString(),
  ): void {
    const update =
      state === "running"
        ? "last_replay_started_at = ?, replay_state = ?, updated_at = ?"
        : state === "completed"
          ? "last_replay_completed_at = ?, replay_state = ?, updated_at = ?"
          : "replay_state = ?, updated_at = ?";
    if (state === "running" || state === "completed") {
      this.db
        .prepare(`UPDATE collector_state SET ${update} WHERE id = 1`)
        .run(timestamp, state, timestamp);
    } else {
      this.db
        .prepare(`UPDATE collector_state SET ${update} WHERE id = 1`)
        .run(state, timestamp);
    }
  }

  recordCursorExpiry(timestamp = new Date().toISOString()): void {
    this.db
      .prepare(
        `UPDATE collector_state
         SET cursor_expiry_count = cursor_expiry_count + 1,
             replay_state = 'expired_cursor', updated_at = ?
         WHERE id = 1`,
      )
      .run(timestamp);
  }

  getHealthState(): CollectorHealthState {
    const row = this.db
      .prepare("SELECT * FROM collector_state WHERE id = 1")
      .get() as StateRow | undefined;
    if (!row)
      throw new AppError(
        "DATABASE_UNAVAILABLE",
        "Collector state has not been initialized.",
      );
    return {
      collectorStartedAt: row.collector_started_at,
      websocketState: row.websocket_state,
      ...(row.last_server_time ? { lastServerTime: row.last_server_time } : {}),
      ...(row.last_received_at ? { lastReceivedAt: row.last_received_at } : {}),
      ...(row.last_committed_event_id
        ? { lastCommittedEventId: row.last_committed_event_id }
        : {}),
      ...(row.last_committed_at
        ? { lastCommittedAt: row.last_committed_at }
        : {}),
      replayState: row.replay_state,
      ...(row.last_replay_started_at
        ? { lastReplayStartedAt: row.last_replay_started_at }
        : {}),
      ...(row.last_replay_completed_at
        ? { lastReplayCompletedAt: row.last_replay_completed_at }
        : {}),
      duplicateCount: row.duplicate_count,
      unknownEventCount: row.unknown_event_count,
      processingErrorCount: row.processing_error_count,
      cursorExpiryCount: row.cursor_expiry_count,
      fullSnapshot: row.full_snapshot === 1,
      updatedAt: row.updated_at,
    };
  }

  setServerTime(
    serverTime: string,
    updatedAt = new Date().toISOString(),
  ): void {
    this.db
      .prepare(
        "UPDATE collector_state SET last_server_time = ?, updated_at = ? WHERE id = 1",
      )
      .run(serverTime, updatedAt);
  }

  private incrementCounter(
    column: "duplicate_count" | "processing_error_count",
  ): void {
    this.db
      .prepare(
        `UPDATE collector_state SET ${column} = ${column} + 1, updated_at = ? WHERE id = 1`,
      )
      .run(new Date().toISOString());
  }

  private recordFailure(
    event: AnyMarketplaceEvent,
    options: ProcessEventOptions,
    error: unknown,
  ): void {
    const message =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Unknown processing failure";
    try {
      this.db
        .prepare(
          `INSERT INTO raw_events
           (event_id, version, type, occurred_at, received_at, receive_sequence,
            raw_payload, processing_status, correlation_id, error_code, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?, 'INTERNAL_ERROR', ?)
           ON CONFLICT(event_id) DO UPDATE SET
             processing_status = 'failed', error_code = 'INTERNAL_ERROR', error_message = excluded.error_message`,
        )
        .run(
          event.eventId,
          event.version,
          event.type,
          event.occurredAt,
          options.receivedAt,
          options.receiveSequence,
          JSON.stringify(event),
          options.correlationId,
          message,
        );
      this.incrementCounter("processing_error_count");
    } catch {
      // Preserve the original transaction error and avoid leaking SQLite internals.
    }
  }
}
