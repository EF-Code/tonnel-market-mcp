import assert from "node:assert/strict";
import test from "node:test";

import {
  ReplayClient,
  ReplayRateLimitedError,
} from "../../src/ingest/replay.js";
import { connectedFixture, fixtureEvent } from "../fixtures/events.js";

test("replay client allowlists event filters and clamps page limits", async () => {
  let requestedUrl = "";
  const client = new ReplayClient({
    endpoint: "https://example.test/events",
    limit: 9_999,
    fetch: async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          status: "success",
          events: [fixtureEvent("listing.created", 70), connectedFixture()],
          nextAfter: null,
        }),
        { status: 200 },
      );
    },
  });
  const page = await client.fetchPage({
    types: ["sale.completed", "listing.created", "sale.completed"],
  });
  assert.equal(page.events.length, 1);
  assert.match(requestedUrl, /limit=500/u);
  assert.match(requestedUrl, /types=listing.created%2Csale.completed/u);
});

test("replay client keeps rate limits and invalid page shapes typed", async () => {
  const limited = new ReplayClient({
    endpoint: "https://example.test/events",
    fetch: async () => new Response("slow down", { status: 429 }),
  });
  await assert.rejects(
    () => limited.fetchPage(),
    (error: unknown) => error instanceof ReplayRateLimitedError,
  );

  const invalid = new ReplayClient({
    endpoint: "https://example.test/events",
    fetch: async () =>
      new Response(JSON.stringify({ status: "success" }), { status: 200 }),
  });
  await assert.rejects(() => invalid.fetchPage(), /invalid page shape/u);
});
