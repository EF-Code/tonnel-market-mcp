import assert from "node:assert/strict";
import test from "node:test";

import { CoverageService } from "../../src/analytics/coverage.js";
import { CoverageRepository } from "../../src/storage/coverage-repository.js";
import { DatabaseManager } from "../../src/storage/database.js";
import { EventRepository } from "../../src/storage/event-repository.js";

test("coverage envelopes surface gaps and the seven-day baseline mode", () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const events = new EventRepository(database);
  events.initializeCollector("2026-08-15T00:00:00.000Z");
  const repository = new CoverageRepository(database.db);
  repository.record(
    "available",
    { from: "2026-08-14T00:00:00.000Z", to: "2026-08-15T00:00:00.000Z" },
    "replayed test interval",
    "test",
  );
  repository.record(
    "gap",
    { from: "2026-08-14T12:00:00.000Z", to: "2026-08-14T13:00:00.000Z" },
    "expired cursor discontinuity",
    "replay",
  );
  const service = new CoverageService(repository, events, database);
  const envelope = service.get({
    from: "2026-08-14T00:00:00.000Z",
    to: "2026-08-15T00:00:00.000Z",
  });
  assert.equal(envelope.mode, "seven_day_replay_baseline");
  assert.equal(envelope.complete, false);
  assert.equal(envelope.requestedWindowCovered, false);
  assert.equal(envelope.gaps.length, 1);
  assert.equal(
    service.warnings(envelope).some((warning) => /gap/u.test(warning)),
    true,
  );
  database.close();
});

test("coverage marks a current connected stream as ready after replay", () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const events = new EventRepository(database);
  events.initializeCollector("2026-08-15T00:00:00.000Z");
  const repository = new CoverageRepository(database.db);
  repository.record(
    "available",
    { from: "2026-08-14T00:00:00.000Z", to: "2026-08-15T00:00:00.000Z" },
    "replayed test interval",
    "replay",
  );
  events.setReplayState("completed", "2026-08-15T00:59:00.000Z");
  events.setWebsocketState("connected", "2026-08-15T00:59:00.000Z");
  const service = new CoverageService(repository, events, database, {
    now: () => "2026-08-15T01:00:00.000Z",
  });

  const envelope = service.get({
    from: "2026-08-15T00:59:30.000Z",
    to: "2026-08-15T01:00:00.000Z",
  });
  assert.equal(envelope.requestedWindowCovered, true);
  assert.deepEqual(envelope.stream, {
    current: true,
    availableFrom: "2026-08-15T00:59:00.000Z",
    availableTo: "2026-08-15T01:00:00.000Z",
  });
  database.close();
});

test("coverage waiting returns ready after the collector catches up", async () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const events = new EventRepository(database);
  events.initializeCollector("2026-08-15T00:00:00.000Z");
  const repository = new CoverageRepository(database.db);
  let sleepCount = 0;
  const service = new CoverageService(repository, events, database, {
    now: () => "2026-08-15T01:00:00.000Z",
    sleep: async () => {
      sleepCount += 1;
      events.setReplayState("completed", "2026-08-15T00:59:00.000Z");
      events.setWebsocketState("connected", "2026-08-15T00:59:00.000Z");
    },
  });

  const result = await service.waitForWindow(
    {
      from: "2026-08-15T00:59:30.000Z",
      to: "2026-08-15T01:00:00.000Z",
    },
    1_000,
  );
  assert.equal(result.ready, true);
  assert.equal(result.coverage.requestedWindowCovered, true);
  assert.equal(sleepCount, 1);
  database.close();
});

test("coverage waiting times out with an explicit incomplete result", async () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const events = new EventRepository(database);
  events.initializeCollector("2026-08-15T00:00:00.000Z");
  const repository = new CoverageRepository(database.db);
  const service = new CoverageService(repository, events, database);

  const result = await service.waitForWindow(
    {
      from: "2026-08-15T00:59:30.000Z",
      to: "2026-08-15T01:00:00.000Z",
    },
    0,
  );
  assert.equal(result.ready, false);
  assert.equal(result.coverage.requestedWindowCovered, false);
  database.close();
});

test("coverage gaps outside a requested window are not returned", () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const events = new EventRepository(database);
  events.initializeCollector("2026-08-15T00:00:00.000Z");
  const repository = new CoverageRepository(database.db);
  repository.record(
    "gap",
    { from: "2026-08-14T00:00:00.000Z", to: "2026-08-14T01:00:00.000Z" },
    "outside request",
    "test",
  );
  const service = new CoverageService(repository, events, database);
  assert.equal(
    service.get({
      from: "2026-08-15T00:00:00.000Z",
      to: "2026-08-15T01:00:00.000Z",
    }).gaps.length,
    0,
  );
  database.close();
});
