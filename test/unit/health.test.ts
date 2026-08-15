import assert from "node:assert/strict";
import test from "node:test";

import { estimateLagSeconds } from "../../src/observability/health.js";

test("health lag uses bounded seconds and handles missing or invalid timestamps", () => {
  const now = Date.parse("2026-08-15T01:00:10.000Z");
  assert.equal(estimateLagSeconds("2026-08-15T01:00:00.000Z", now), 10);
  assert.equal(estimateLagSeconds("2026-08-15T01:00:20.000Z", now), 0);
  assert.equal(estimateLagSeconds(undefined, now), undefined);
  assert.equal(estimateLagSeconds("not-a-time", now), undefined);
});
