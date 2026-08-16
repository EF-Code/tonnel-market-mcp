import assert from "node:assert/strict";
import test from "node:test";

import {
  marketResult,
  toolFailure,
  toolSuccess,
} from "../../src/mcp/result-envelope.js";

test("successful market results expose provenance, warnings, and pagination", () => {
  const result = toolSuccess(
    marketResult({
      data: { observations: [] },
      coverage: {
        complete: false,
        mode: "partial" as const,
        gaps: [],
        collectorStartedAt: "2026-08-15T00:00:00.000Z",
        stream: { current: false },
        fullSnapshot: false,
      },
      canonicalEventTypes: ["sale.completed", "sale.completed"],
      eventIds: ["event-1"],
      warnings: ["incomplete"],
      nextCursor: "opaque-cursor",
    }),
  );
  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as {
    provenance: { canonicalEventTypes: string[] };
    pagination: { nextCursor: string };
  };
  assert.deepEqual(structured.provenance.canonicalEventTypes, [
    "sale.completed",
  ]);
  assert.equal(structured.pagination.nextCursor, "opaque-cursor");
});

test("tool failures expose only stable safe error fields", () => {
  const result = toolFailure(new Error("private stack path"));
  assert.equal(result.isError, true);
  const content = result.content[0];
  assert.equal(content?.type, "text");
  if (content?.type === "text") {
    assert.doesNotMatch(content.text, /private stack path/u);
    assert.match(content.text, /INTERNAL_ERROR/u);
  }
});
