import assert from "node:assert/strict";
import test from "node:test";

import { DatabaseManager } from "../../src/storage/database.js";
import { EventRepository } from "../../src/storage/event-repository.js";
import { ProjectionRepository } from "../../src/storage/projection-repository.js";
import { QueryRepository } from "../../src/storage/query-repository.js";
import { fixtureEvent } from "../fixtures/events.js";

test("occurred-time search and gift history return stable opaque cursors", () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const events = new EventRepository(database);
  const projections = new ProjectionRepository();
  const query = new QueryRepository(database.db);
  events.initializeCollector("2026-08-15T00:00:00.000Z");
  for (const [index, event] of [
    fixtureEvent("listing.created", 1),
    fixtureEvent("listing.price_changed", 2),
    fixtureEvent("sale.completed", 3),
  ].entries()) {
    events.processEvent(
      event,
      {
        source: "replay",
        receivedAt: "2026-08-15T01:00:00.000Z",
        receiveSequence: index + 1,
        correlationId: `page-${index}`,
      },
      (db) => projections.apply(db, event),
    );
  }

  const first = query.search({ limit: 1, sort: "occurred_asc" });
  assert.equal(first.results.length, 1);
  assert.equal(typeof first.nextCursor, "string");
  const second = query.search({
    limit: 1,
    sort: "occurred_asc",
    ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
  });
  assert.equal(second.results.length, 1);
  assert.notEqual(second.results[0]?.eventId, first.results[0]?.eventId);

  const history = query.history({
    giftId: 123,
    limit: 1,
  });
  assert.equal(history.results.length, 1);
  assert.equal(typeof history.nextCursor, "string");
  database.close();
});
