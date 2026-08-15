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
  assert.equal(envelope.gaps.length, 1);
  assert.equal(
    service.warnings(envelope).some((warning) => /gap/u.test(warning)),
    true,
  );
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
