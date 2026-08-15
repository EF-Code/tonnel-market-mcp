import * as z from "zod/v4";

import {
  EVENT_TYPES,
  type AnyMarketplaceEvent,
  type ConnectedMessage,
  type KnownEventType,
  type MarketplaceMessage,
} from "./events.js";
import { AppError } from "./errors.js";

const objectWithUnknownFields = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).catchall(z.unknown());

const nonEmptyString = z.string().min(1).max(2_000);
const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();
const nonNegativeNumber = z.number().finite().nonnegative();
const isoDate = z.string().refine((value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && value.endsWith("Z");
}, "Expected an ISO 8601 UTC timestamp ending in Z");

const publicGiftSchema = objectWithUnknownFields({
  gift_id: positiveInteger,
  gift_num: positiveInteger,
  gift_name: nonEmptyString,
  model: nonEmptyString,
  backdrop: nonEmptyString,
  symbol: nonEmptyString,
});

const assetSchema = nonEmptyString.max(64);
const saleTypeSchema = z.enum(["FIXED", "DUTCH"]);
const saleSourceSchema = z.enum(["LISTING", "DUTCH", "BUY_OFFER", "AUCTION"]);
const dutchSchema = objectWithUnknownFields({
  start_price: nonNegativeNumber,
  minimum_price: nonNegativeNumber,
  drop_percent: nonNegativeNumber,
  interval_minutes: nonNegativeNumber,
  starts_at: isoDate,
});

const eventDataSchemas = {
  "gift.indexed": objectWithUnknownFields({
    gift: publicGiftSchema,
    market: z.literal("PREMARKET").optional(),
  }),
  "listing.created": objectWithUnknownFields({
    gift: publicGiftSchema,
    price: nonNegativeNumber,
    asset: assetSchema,
    sale_type: saleTypeSchema,
    dutch: dutchSchema.optional(),
  }),
  "listing.price_changed": objectWithUnknownFields({
    gift: publicGiftSchema,
    previous_price: nonNegativeNumber,
    price: nonNegativeNumber,
    asset: assetSchema,
  }),
  "listing.cancelled": objectWithUnknownFields({
    gift: publicGiftSchema,
    price: nonNegativeNumber,
    asset: assetSchema,
    sale_type: saleTypeSchema,
  }),
  "listing.promoted": objectWithUnknownFields({
    gift: publicGiftSchema,
    target: z.enum(["LISTING", "AUCTION"]),
    auction_id: nonEmptyString.optional(),
    promotion_started_at: isoDate.optional(),
  }),
  "listing.promotion_ended": objectWithUnknownFields({
    target: z.enum(["LISTING", "AUCTION"]),
    count: nonNegativeInteger,
    expired_before: isoDate,
  }),
  "sale.completed": objectWithUnknownFields({
    gift: publicGiftSchema,
    price: nonNegativeNumber,
    asset: assetSchema,
    source: saleSourceSchema,
  }),
  "auction.created": objectWithUnknownFields({
    auction_id: nonEmptyString,
    gift: publicGiftSchema,
    starting_bid: nonNegativeNumber,
    asset: assetSchema,
    starts_at: isoDate,
    ends_at: isoDate,
  }),
  "auction.bid_placed": objectWithUnknownFields({
    auction_id: nonEmptyString,
    gift: publicGiftSchema,
    amount: nonNegativeNumber,
    asset: assetSchema,
    ends_at: isoDate,
  }),
  "auction.extended": objectWithUnknownFields({
    auction_id: nonEmptyString,
    gift_id: positiveInteger,
    previous_ends_at: isoDate,
    ends_at: isoDate,
  }),
  "auction.cancelled": objectWithUnknownFields({
    auction_id: nonEmptyString,
    gift_id: positiveInteger,
  }),
  "auction.finished": objectWithUnknownFields({
    auction_id: nonEmptyString,
    status: z.enum(["SOLD", "NO_BIDS"]),
    gift: publicGiftSchema.optional(),
    winning_bid: nonNegativeNumber.optional(),
    asset: assetSchema.optional(),
    gift_id: positiveInteger.optional(),
  }).superRefine((value, context) => {
    if (value.status === "SOLD") {
      if (
        !value.gift ||
        value.winning_bid === undefined ||
        value.asset === undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "SOLD auctions require gift, winning_bid, and asset",
        });
      }
    } else if (value.gift_id === undefined) {
      context.addIssue({
        code: "custom",
        message: "NO_BIDS auctions require gift_id",
      });
    }
  }),
  "buy_offer.created": objectWithUnknownFields({
    offer_id: nonEmptyString,
    gift: publicGiftSchema,
    price: nonNegativeNumber,
    asset: assetSchema,
  }),
  "buy_offer.countered": objectWithUnknownFields({
    offer_id: nonEmptyString,
    gift: publicGiftSchema,
    original_price: nonNegativeNumber,
    counter_price: nonNegativeNumber,
    asset: assetSchema,
  }),
  "buy_offer.accepted": objectWithUnknownFields({
    offer_id: nonEmptyString,
    gift_id: positiveInteger,
    price: nonNegativeNumber,
    asset: assetSchema,
    stage: z.enum(["OFFER", "COUNTER"]),
  }),
  "buy_offer.rejected": objectWithUnknownFields({
    offer_id: nonEmptyString,
    gift_id: positiveInteger,
    price: nonNegativeNumber,
    asset: assetSchema,
    stage: z.enum(["OFFER", "COUNTER"]),
  }),
  "buy_offer.cancelled": objectWithUnknownFields({
    offer_id: nonEmptyString,
    gift_id: positiveInteger,
    price: nonNegativeNumber,
    asset: assetSchema,
  }),
  "premarket.listing_created": objectWithUnknownFields({
    gift: publicGiftSchema,
    price: nonNegativeNumber,
    asset: assetSchema,
  }),
  "premarket.sale_completed": objectWithUnknownFields({
    gift: publicGiftSchema,
    price: nonNegativeNumber,
    price_with_fee: nonNegativeNumber,
    asset: assetSchema,
  }),
  "premarket.listing_cancelled": objectWithUnknownFields({
    gift: publicGiftSchema,
    previous_price: nonNegativeNumber,
    asset: assetSchema,
  }),
  "premarket.settled": objectWithUnknownFields({
    gift: publicGiftSchema,
    status: z.literal("COMPLETED"),
    amount: nonNegativeNumber,
    asset: assetSchema,
  }),
  "bundle.created": objectWithUnknownFields({
    bundle_id: nonEmptyString,
    gift_ids: z.array(positiveInteger).max(1_000),
  }),
  "bundle.debundled": objectWithUnknownFields({
    bundle_id: nonEmptyString,
    gift_ids: z.array(positiveInteger).max(1_000),
  }),
  "trade.created": objectWithUnknownFields({
    trade_id: nonEmptyString,
    gift_ids: z.array(positiveInteger).max(1_000),
    amount: nonNegativeNumber,
    asset: assetSchema,
  }),
  "trade.offer_created": objectWithUnknownFields({
    trade_id: nonEmptyString,
    offer_id: nonEmptyString,
    gift_ids: z.array(positiveInteger).max(1_000),
    amount: nonNegativeNumber,
    asset: assetSchema,
  }),
  "trade.completed": objectWithUnknownFields({
    trade_id: nonEmptyString,
    offer_id: nonEmptyString,
    requested_gift_ids: z.array(positiveInteger).max(1_000),
    offered_gift_ids: z.array(positiveInteger).max(1_000),
    requested_amount: nonNegativeNumber,
    requested_asset: assetSchema,
    offered_amount: nonNegativeNumber,
    offered_asset: assetSchema,
  }),
  "trade.cancelled": objectWithUnknownFields({
    trade_id: nonEmptyString,
    gift_ids: z.array(positiveInteger).max(1_000),
  }),
} as const;

const connectedMessageSchema = objectWithUnknownFields({
  type: z.literal("marketplace.connected"),
  version: z.literal(1),
  serverTime: isoDate,
  replayEndpoint: nonEmptyString,
});

const eventEnvelopeSchema = objectWithUnknownFields({
  eventId: nonEmptyString.max(256),
  version: z.number().int(),
  type: nonEmptyString.max(256),
  occurredAt: isoDate,
  data: z.record(z.string(), z.unknown()),
});

export type ParsedMarketplaceMessage =
  | { kind: "connected"; message: ConnectedMessage }
  | { kind: "event"; event: AnyMarketplaceEvent }
  | { kind: "ignored"; reason: "non_event_message" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Upstream message was not valid JSON.",
      { cause: error },
    );
  }
}

function invalidPayload(
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new AppError("INVALID_ARGUMENT", message, details ? { details } : {});
}

export function parseMarketplaceMessage(
  raw: unknown,
): ParsedMarketplaceMessage {
  const value = parseJson(raw);
  if (!isRecord(value))
    return invalidPayload("Marketplace message must be a JSON object.");

  if (value.type === "marketplace.connected") {
    const connected = connectedMessageSchema.safeParse(value);
    if (!connected.success) {
      return invalidPayload("Invalid marketplace.connected message.", {
        issues: connected.error.issues,
      });
    }
    return { kind: "connected", message: connected.data };
  }

  if (!("eventId" in value))
    return { kind: "ignored", reason: "non_event_message" };

  const envelope = eventEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    return invalidPayload("Invalid marketplace event envelope.", {
      issues: envelope.error.issues,
    });
  }
  if (envelope.data.version !== 1) {
    throw new AppError(
      "UNSUPPORTED_EVENT_VERSION",
      "Unsupported marketplace event envelope version.",
      {
        details: {
          version: envelope.data.version,
          eventId: envelope.data.eventId,
        },
      },
    );
  }

  const eventType = envelope.data.type;
  if (!isKnownEventTypeValue(eventType)) {
    return {
      kind: "event",
      event: {
        eventId: envelope.data.eventId,
        version: 1,
        type: eventType,
        occurredAt: envelope.data.occurredAt,
        data: envelope.data.data,
      },
    };
  }

  const dataSchema = eventDataSchemas[eventType];
  const data = dataSchema.safeParse(envelope.data.data);
  if (!data.success) {
    return invalidPayload(`Invalid data for marketplace event ${eventType}.`, {
      issues: data.error.issues,
      eventId: envelope.data.eventId,
    });
  }

  return {
    kind: "event",
    event: {
      eventId: envelope.data.eventId,
      version: 1,
      type: eventType,
      occurredAt: envelope.data.occurredAt,
      data: data.data,
    } as AnyMarketplaceEvent,
  };
}

function isKnownEventTypeValue(type: string): type is KnownEventType {
  return (EVENT_TYPES as readonly string[]).includes(type);
}

export function parseMarketplaceEvent(raw: unknown): AnyMarketplaceEvent {
  const parsed = parseMarketplaceMessage(raw);
  if (parsed.kind !== "event") {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Expected a marketplace event message.",
    );
  }
  return parsed.event;
}

export function isMarketplaceConnectedMessage(
  raw: unknown,
): raw is ConnectedMessage {
  return parseMarketplaceMessage(raw).kind === "connected";
}

export function toMarketplaceMessage(
  event: AnyMarketplaceEvent,
): MarketplaceMessage {
  return event;
}
