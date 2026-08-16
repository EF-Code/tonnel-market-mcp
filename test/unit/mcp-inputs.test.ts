import assert from "node:assert/strict";
import test from "node:test";

import {
  marketCreateAlertSchema,
  marketFindOpportunitiesSchema,
  marketRecentListingsSchema,
  marketSearchSchema,
} from "../../src/mcp/schemas.js";

test("MCP query inputs apply bounded defaults and reject reversed windows", () => {
  const parsed = marketSearchSchema.parse({ giftId: 123 });
  assert.equal(parsed.limit, 50);
  assert.equal(parsed.sort, "occurred_desc");
  const recent = marketRecentListingsSchema.parse({});
  assert.equal(recent.minutes, 5);
  assert.equal(recent.waitSeconds, 30);
  assert.deepEqual(recent.eventTypes, [
    "listing.created",
    "listing.price_changed",
  ]);
  assert.throws(
    () =>
      marketSearchSchema.parse({
        from: "2026-08-15T02:00:00.000Z",
        to: "2026-08-15T01:00:00.000Z",
      }),
    /must be before/u,
  );
});

test("opportunity and alert inputs remain bounded and strategy-specific", () => {
  const opportunity = marketFindOpportunitiesSchema.parse({
    strategy: "auction_ending",
    lookbackFrom: "2026-08-15T00:00:00.000Z",
    lookbackTo: "2026-08-15T01:00:00.000Z",
    minimumBidCount: 3,
  });
  assert.equal(opportunity.limit, 50);
  assert.throws(
    () =>
      marketCreateAlertSchema.parse({ name: "x", minPrice: 10, maxPrice: 1 }),
    /cannot exceed/u,
  );
  assert.throws(
    () => marketSearchSchema.parse({ minPrice: "not-decimal" }),
    /valid decimal/u,
  );
});
