import assert from "node:assert/strict";
import test from "node:test";

import { AlertEngine } from "../../src/alerts/engine.js";
import { AlertRepository } from "../../src/storage/alert-repository.js";
import { DatabaseManager } from "../../src/storage/database.js";
import { fixtureEvent } from "../fixtures/events.js";

test("alert hits are durable and deduplicated when notifier delivery fails", () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const repository = new AlertRepository(database.db);
  const alert = repository.create({
    name: "Freshwave under twenty",
    eventTypes: ["listing.created"],
    model: "Freshwave",
    maxPrice: "20",
  });
  const notifier = {
    notify: async () => {
      throw new Error("simulated notifier outage");
    },
  };
  const engine = new AlertEngine(repository, notifier);
  const event = fixtureEvent("listing.created", 50);

  assert.equal(
    engine.evaluate(database.db, event, "2026-08-15T02:00:00.000Z"),
    1,
  );
  assert.equal(
    engine.evaluate(database.db, event, "2026-08-15T02:01:00.000Z"),
    0,
  );
  assert.equal(repository.listHits(alert.id, 10).length, 1);
  repository.delete(alert.id);
  assert.throws(() => repository.get(alert.id), /Alert rule was not found/u);
  database.close();
});

test("alert rules reject unknown event types and inverted price bounds", () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const repository = new AlertRepository(database.db);
  assert.throws(
    () => repository.create({ name: "unknown", eventTypes: ["future.event"] }),
    /unknown event type/u,
  );
  assert.throws(
    () => repository.create({ name: "inverted", minPrice: 20, maxPrice: 10 }),
    /cannot exceed/u,
  );
  database.close();
});
