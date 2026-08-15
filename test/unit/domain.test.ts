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
