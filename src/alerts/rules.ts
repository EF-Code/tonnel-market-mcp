import {
  isKnownEventType,
  type AnyMarketplaceEvent,
  type KnownEventType,
} from "../domain/events.js";
import { AppError } from "../domain/errors.js";
import {
  compareDecimal,
  decimal,
  type DecimalString,
} from "../domain/money.js";

export type AlertRuleInput = {
  name: string;
  enabled?: boolean;
  eventTypes?: string[];
  giftId?: number;
  giftName?: string;
  model?: string;
  backdrop?: string;
  symbol?: string;
  asset?: string;
  saleType?: "FIXED" | "DUTCH";
  source?: "LISTING" | "DUTCH" | "BUY_OFFER" | "AUCTION";
  minPrice?: string | number;
  maxPrice?: string | number;
  auctionEndsWithinMinutes?: number;
  strategy?:
    | "below_recent_median"
    | "price_drop"
    | "auction_ending"
    | "offer_activity"
    | "premarket_spread";
};

export type AlertRule = Omit<
  AlertRuleInput,
  "minPrice" | "maxPrice" | "eventTypes"
> & {
  id: number;
  enabled: boolean;
  eventTypes?: KnownEventType[];
  minPrice?: DecimalString;
  maxPrice?: DecimalString;
  createdAt: string;
  updatedAt: string;
};

export function validateAlertRule(
  input: AlertRuleInput,
): Omit<AlertRule, "id" | "createdAt" | "updatedAt"> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Alert name must contain 1 to 100 characters.",
    );
  }
  const eventTypes = input.eventTypes
    ? [...new Set(input.eventTypes)]
    : undefined;
  const invalidTypes = eventTypes?.filter((type) => !isKnownEventType(type));
  if (invalidTypes && invalidTypes.length > 0) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Alert contains an unknown event type.",
      {
        details: { invalidTypes },
      },
    );
  }
  if (
    input.giftId !== undefined &&
    (!Number.isInteger(input.giftId) || input.giftId < 1)
  ) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Alert giftId must be a positive integer.",
    );
  }
  if (
    input.auctionEndsWithinMinutes !== undefined &&
    (!Number.isInteger(input.auctionEndsWithinMinutes) ||
      input.auctionEndsWithinMinutes < 0 ||
      input.auctionEndsWithinMinutes > 10_080)
  ) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "auctionEndsWithinMinutes must be between 0 and 10080.",
    );
  }
  const minPrice =
    input.minPrice === undefined ? undefined : decimal(input.minPrice);
  const maxPrice =
    input.maxPrice === undefined ? undefined : decimal(input.maxPrice);
  if (minPrice && maxPrice && compareDecimal(minPrice, maxPrice) > 0) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "Alert minPrice cannot exceed maxPrice.",
    );
  }
  return {
    name,
    enabled: input.enabled ?? true,
    ...(eventTypes && eventTypes.length > 0
      ? { eventTypes: eventTypes as KnownEventType[] }
      : {}),
    ...(input.giftId !== undefined ? { giftId: input.giftId } : {}),
    ...(input.giftName ? { giftName: input.giftName } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.backdrop ? { backdrop: input.backdrop } : {}),
    ...(input.symbol ? { symbol: input.symbol } : {}),
    ...(input.asset ? { asset: input.asset } : {}),
    ...(input.saleType ? { saleType: input.saleType } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(minPrice ? { minPrice } : {}),
    ...(maxPrice ? { maxPrice } : {}),
    ...(input.auctionEndsWithinMinutes !== undefined
      ? { auctionEndsWithinMinutes: input.auctionEndsWithinMinutes }
      : {}),
    ...(input.strategy ? { strategy: input.strategy } : {}),
  };
}

export function matchesAlert(
  rule: AlertRule,
  event: AnyMarketplaceEvent,
  now = new Date().toISOString(),
): boolean {
  if (!rule.enabled) return false;
  if (
    rule.eventTypes &&
    !rule.eventTypes.includes(event.type as KnownEventType)
  )
    return false;
  const recordData = event.data as unknown as Record<string, unknown>;
  const gift = isRecord(recordData.gift) ? recordData.gift : undefined;
  if (rule.giftId !== undefined && !containsGift(recordData, rule.giftId))
    return false;
  if (rule.giftName && !includesIgnoreCase(gift?.gift_name, rule.giftName))
    return false;
  if (rule.model && !includesIgnoreCase(gift?.model, rule.model)) return false;
  if (rule.backdrop && !includesIgnoreCase(gift?.backdrop, rule.backdrop))
    return false;
  if (rule.symbol && !includesIgnoreCase(gift?.symbol, rule.symbol))
    return false;
  if (
    rule.asset &&
    getString(recordData, "asset") !== rule.asset &&
    getString(recordData, "requested_asset") !== rule.asset &&
    getString(recordData, "offered_asset") !== rule.asset
  )
    return false;
  if (rule.saleType && getString(recordData, "sale_type") !== rule.saleType)
    return false;
  if (rule.source && getString(recordData, "source") !== rule.source)
    return false;
  const price = extractAlertPrice(recordData);
  if (rule.minPrice && (!price || compareDecimal(price, rule.minPrice) < 0))
    return false;
  if (rule.maxPrice && (!price || compareDecimal(price, rule.maxPrice) > 0))
    return false;
  if (rule.auctionEndsWithinMinutes !== undefined) {
    const endsAt = getString(recordData, "ends_at");
    if (!endsAt) return false;
    const remaining = Date.parse(endsAt) - Date.parse(now);
    if (remaining < 0 || remaining > rule.auctionEndsWithinMinutes * 60_000)
      return false;
  }
  return true;
}

function extractAlertPrice(
  data: Record<string, unknown>,
): DecimalString | undefined {
  const candidates = [
    "price",
    "counter_price",
    "amount",
    "winning_bid",
    "starting_bid",
  ];
  for (const key of candidates) {
    const value = data[key];
    if (typeof value === "number" || typeof value === "string") {
      try {
        return decimal(value);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function containsGift(data: Record<string, unknown>, giftId: number): boolean {
  if (isRecord(data.gift) && data.gift.gift_id === giftId) return true;
  return ["gift_id", "gift_ids", "requested_gift_ids", "offered_gift_ids"].some(
    (key) => {
      const value = data[key];
      return (
        value === giftId || (Array.isArray(value) && value.includes(giftId))
      );
    },
  );
}

function getString(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof data[key] === "string" ? data[key] : undefined;
}

function includesIgnoreCase(value: unknown, query: string): boolean {
  return (
    typeof value === "string" &&
    value.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
