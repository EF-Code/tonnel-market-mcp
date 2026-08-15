import assert from "node:assert/strict";
import test from "node:test";

import { allKnownFixtures, unknownFixture } from "../fixtures/events.js";
import { DatabaseManager } from "../../src/storage/database.js";
import { EventRepository } from "../../src/storage/event-repository.js";
import { ProjectionRepository } from "../../src/storage/projection-repository.js";
import { QueryRepository } from "../../src/storage/query-repository.js";

function setup() {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  assert.equal(database.migrate(), 1);
  const events = new EventRepository(database);
  events.initializeCollector("2026-08-15T00:00:00.000Z");
  return {
    database,
    events,
    projections: new ProjectionRepository(),
    query: new QueryRepository(database.db),
  };
}

test("projects every known event and counts canonical sales once", () => {
  const { database, events, projections, query } = setup();
  for (const [index, event] of allKnownFixtures.entries()) {
    events.processEvent(
      event,
      {
        source: "replay",
        receivedAt: "2026-08-15T02:00:00.000Z",
        receiveSequence: index + 1,
        correlationId: `test-${index}`,
      },
      (db) => projections.apply(db, event),
    );
  }
  const unknown = unknownFixture();
  events.processEvent(
    unknown,
    {
      source: "replay",
      receivedAt: "2026-08-15T02:01:00.000Z",
      receiveSequence: 100,
      correlationId: "unknown",
    },
    (db) => projections.apply(db, unknown),
  );
  assert.equal(
    (
      database.db.prepare("SELECT COUNT(*) AS count FROM raw_events").get() as {
        count: number;
      }
    ).count,
    28,
  );
  assert.equal(
    (
      database.db.prepare("SELECT COUNT(*) AS count FROM sale_facts").get() as {
        count: number;
      }
    ).count,
    1,
  );
  assert.equal(
    (
      database.db
        .prepare("SELECT COUNT(*) AS count FROM auction_bids")
        .get() as { count: number }
    ).count,
    1,
  );
  assert.equal(events.getHealthState().unknownEventCount, 1);
  assert.equal(query.sales({}).length, 1);
  assert.equal(
    query.listAuctions({ auctionId: "auction-1", limit: 10 })[0]?.bidCount,
    1,
  );
  const search = query.search({
    giftId: 123,
    asset: "TON",
    limit: 100,
    sort: "occurred_asc",
  });
  assert.ok(search.results.some((row) => row.type === "listing.created"));

  const duplicate = events.processEvent(
    allKnownFixtures[0]!,
    {
      source: "websocket",
      receivedAt: "2026-08-15T02:02:00.000Z",
      receiveSequence: 101,
      correlationId: "duplicate",
    },
    () => assert.fail("duplicate must not re-run projection"),
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(events.getHealthState().duplicateCount, 1);
  database.close();
});

test("rolls back projections and does not advance the checkpoint on failure", () => {
  const { database, events } = setup();
  const event = allKnownFixtures.find(
    (item) => item.type === "sale.completed",
  )!;
  assert.throws(() =>
    events.processEvent(
      event,
      {
        source: "replay",
        receivedAt: "2026-08-15T03:00:00.000Z",
        receiveSequence: 1,
        correlationId: "rollback",
      },
      () => {
        throw new Error("projection failure");
      },
    ),
  );
  assert.equal(events.getCheckpoint(), undefined);
  assert.equal(
    (
      database.db
        .prepare("SELECT processing_status FROM raw_events WHERE event_id = ?")
        .get(event.eventId) as { processing_status: string }
    ).processing_status,
    "failed",
  );
  assert.equal(events.getHealthState().processingErrorCount, 1);
  database.close();
});
