import assert from "node:assert/strict";
import test from "node:test";

import { allKnownFixtures, unknownFixture } from "../fixtures/events.js";
import { DatabaseManager } from "../../src/storage/database.js";
import { EventRepository } from "../../src/storage/event-repository.js";
import { ProjectionRepository } from "../../src/storage/projection-repository.js";

test("complete event fixtures populate each required normalized projection", () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const events = new EventRepository(database);
  const projections = new ProjectionRepository();
  events.initializeCollector("2026-08-15T00:00:00.000Z");
  for (const [index, event] of [
    ...allKnownFixtures,
    unknownFixture(),
  ].entries()) {
    events.processEvent(
      event,
      {
        source: "replay",
        receivedAt: "2026-08-15T01:00:00.000Z",
        receiveSequence: index + 1,
        correlationId: `projection-${index}`,
      },
      (db) => projections.apply(db, event),
    );
  }

  const count = (table: string): number =>
    Number(
      (
        database.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        }
      ).count,
    );
  assert.equal(count("raw_events"), 28);
  assert.equal(count("gifts"), 1);
  assert.equal(count("listing_observations"), 5);
  assert.equal(count("sale_facts"), 1);
  assert.equal(count("auctions"), 1);
  assert.equal(count("auction_bids"), 1);
  assert.equal(count("buy_offers"), 5);
  assert.equal(count("premarket_facts"), 4);
  assert.equal(count("bundles"), 2);
  assert.equal(count("trades"), 4);
  database.close();
});
