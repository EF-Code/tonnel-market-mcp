import assert from "node:assert/strict";
import test from "node:test";

import {
  allKnownFixtures,
  connectedFixture,
  fixtureEvent,
  fixtureGift,
  unknownFixture,
} from "../fixtures/events.js";
import { decimal, divideDecimal } from "../../src/domain/money.js";
import { isAppError } from "../../src/domain/errors.js";
import { parseMarketplaceEvent } from "../../src/domain/schemas.js";

test("validates every known upstream event type", () => {
  assert.equal(allKnownFixtures.length, 27);
  assert.equal(new Set(allKnownFixtures.map((event) => event.type)).size, 27);
});

test("accepts additive fields while preserving them in the event data", () => {
  const event = parseMarketplaceEvent({
    ...fixtureEvent("listing.created"),
    data: {
      ...fixtureEvent("listing.created").data,
      future_field: { safe: true },
    },
  });
  assert.deepEqual((event.data as Record<string, unknown>).future_field, {
    safe: true,
  });
});

test("preserves unknown event types as raw-compatible events", () => {
  const event = unknownFixture();
  assert.equal(event.type, "future.event.added");
  assert.equal(
    (event.data as Record<string, unknown>).gift_id,
    fixtureGift.gift_id,
  );
});

test("normalizes observed upstream identifier and trait variants", () => {
  const auction = parseMarketplaceEvent({
    eventId: "observed-auction-cancelled",
    version: 1,
    type: "auction.cancelled",
    occurredAt: "2026-08-15T00:00:00.000Z",
    data: {
      auction_id: "4PQA7B82",
      gift_id: -618960119,
    },
  });
  assert.equal(auction.type, "auction.cancelled");
  assert.equal(auction.data.gift_id, -618960119);

  const bundle = parseMarketplaceEvent({
    eventId: "observed-bundle-debundled",
    version: 1,
    type: "bundle.debundled",
    occurredAt: "2026-08-15T00:00:00.000Z",
    data: {
      bundle_id: 618960119,
      gift_ids: [10384686, 10384685],
    },
  });
  assert.equal(bundle.type, "bundle.debundled");
  assert.equal(bundle.data.bundle_id, "618960119");

  const bid = parseMarketplaceEvent({
    ...fixtureEvent("auction.bid_placed"),
    data: {
      ...fixtureEvent("auction.bid_placed").data,
      gift: { ...fixtureGift, model: "", backdrop: "", symbol: "" },
    },
  });
  assert.equal(bid.type, "auction.bid_placed");
  const bidGift = (
    bid.data as {
      gift: { model: string; backdrop: string; symbol: string };
    }
  ).gift;
  assert.equal(bidGift.model, "");
  assert.equal(bidGift.backdrop, "");
  assert.equal(bidGift.symbol, "");
});

test("keeps ordinary gift identifiers positive and safely bounded", () => {
  assert.throws(() =>
    parseMarketplaceEvent({
      ...fixtureEvent("gift.indexed"),
      data: { gift: { ...fixtureGift, gift_num: 0 } },
    }),
  );
  assert.throws(() =>
    parseMarketplaceEvent({
      ...fixtureEvent("bundle.created"),
      data: { bundle_id: "bundle-1", gift_ids: [0] },
    }),
  );
  assert.throws(() =>
    parseMarketplaceEvent({
      ...fixtureEvent("auction.cancelled"),
      data: {
        auction_id: Number.MAX_SAFE_INTEGER + 1,
        gift_id: fixtureGift.gift_id,
      },
    }),
  );
});

test("rejects incompatible envelope versions safely", () => {
  assert.throws(
    () =>
      parseMarketplaceEvent({
        eventId: "version-2",
        version: 2,
        type: "listing.created",
        occurredAt: "2026-08-15T00:00:00.000Z",
        data: {},
      }),
    (error: unknown) =>
      isAppError(error) && error.code === "UNSUPPORTED_EVENT_VERSION",
  );
});

test("does not treat marketplace.connected as a marketplace event", () => {
  const parsed = connectedFixture();
  assert.equal(parsed.kind, "connected");
});

test("normalizes monetary values without binary noise", () => {
  assert.equal(decimal(2.5), "2.5");
  assert.equal(decimal("0002.5000"), "2.5");
  assert.equal(decimal("1e-7"), "0.0000001");
  assert.equal(divideDecimal("3", 2), "1.5");
});
