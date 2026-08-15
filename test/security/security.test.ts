import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../../src/config.js";
import { toSafeError } from "../../src/domain/errors.js";
import { parseMarketplaceEvent } from "../../src/domain/schemas.js";
import { createLogger } from "../../src/observability/logger.js";
import { DatabaseManager } from "../../src/storage/database.js";
import { EventRepository } from "../../src/storage/event-repository.js";
import { ProjectionRepository } from "../../src/storage/projection-repository.js";
import { QueryRepository } from "../../src/storage/query-repository.js";
import { fixtureGift } from "../fixtures/events.js";

test("parameterized projection keeps hostile upstream strings as data", () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const events = new EventRepository(database);
  const projections = new ProjectionRepository();
  events.initializeCollector("2026-08-15T00:00:00.000Z");
  const hostileName = "gift'); DROP TABLE gifts; --";
  const event = parseMarketplaceEvent({
    eventId: "security-hostile-gift",
    version: 1,
    type: "listing.created",
    occurredAt: "2026-08-15T00:00:00.000Z",
    data: {
      gift: { ...fixtureGift, gift_name: hostileName },
      price: 1.25,
      asset: "TON",
      sale_type: "FIXED",
    },
  });
  events.processEvent(
    event,
    {
      source: "replay",
      receivedAt: "2026-08-15T00:00:01.000Z",
      receiveSequence: 1,
      correlationId: "security-test",
    },
    (db) => projections.apply(db, event),
  );

  const query = new QueryRepository(database.db);
  const result = query.search({
    giftName: hostileName,
    limit: 10,
    sort: "occurred_asc",
  });
  assert.equal(result.results.length, 1);
  assert.equal(
    (
      database.db.prepare("SELECT COUNT(*) AS count FROM gifts").get() as {
        count: number;
      }
    ).count,
    1,
  );
  database.close();
});

test("malformed cursors fail closed without changing the query surface", () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const query = new QueryRepository(database.db);
  assert.throws(
    () => query.search({ cursor: "not-a-valid-cursor", limit: 10 }),
    /pagination cursor is invalid/u,
  );
  assert.equal(
    (
      database.db
        .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
        .get() as { count: number }
    ).count,
    1,
  );
  database.close();
});

test("logger redaction omits credentials from stderr fields", () => {
  const originalError = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    createLogger("debug").error("upstream failure", {
      authorization: "Bearer very-secret-token",
      token: "very-secret-token",
      safeField: "retained",
    });
  } finally {
    console.error = originalError;
  }
  const output = lines.join("\n");
  assert.equal(output.includes("very-secret-token"), false);
  assert.equal(output.includes("retained"), true);
});

test("safe error serialization never exposes an unknown error cause", () => {
  const safe = toSafeError(
    new Error("/home/wellington/private/token=should-not-leak"),
    "security-correlation",
  );
  assert.deepEqual(safe, {
    code: "INTERNAL_ERROR",
    message: "An internal error occurred while processing the request.",
    correlationId: "security-correlation",
    retryable: false,
  });
});

test("public HTTP binding requires an explicit bearer token", () => {
  const base = {
    TONNEL_MARKET_HTTP_HOST: "0.0.0.0",
    TONNEL_MARKET_HTTP_PUBLIC: "true",
    TONNEL_MARKET_HTTP_PORT: "8787",
  };
  assert.throws(() => loadConfig(base), /requires TONNEL_MARKET_HTTP_TOKEN/u);
  const config = loadConfig({
    ...base,
    TONNEL_MARKET_HTTP_TOKEN: "local-test-token",
  });
  assert.equal(config.httpPublic, true);
  assert.equal(config.httpToken, "local-test-token");
});
