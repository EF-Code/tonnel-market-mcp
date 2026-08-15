import {
  compareDecimal,
  decimal,
  type DecimalString,
} from "../domain/money.js";
import type { PublicGift } from "../domain/events.js";
import type { SqliteDatabase } from "./database.js";

export type QueryWindow = {
  from?: string;
  to?: string;
};

export type SearchOptions = QueryWindow & {
  giftId?: number;
  giftNum?: number;
  giftName?: string;
  model?: string;
  backdrop?: string;
  symbol?: string;
  eventTypes?: string[];
  asset?: string;
  saleType?: string;
  source?: string;
  minPrice?: string | number;
  maxPrice?: string | number;
  sort?: "occurred_desc" | "occurred_asc" | "price_asc" | "price_desc";
  limit: number;
  cursor?: string;
};

export type SearchObservation = {
  eventId: string;
  type: string;
  occurredAt: string;
  gift?: PublicGift;
  price?: DecimalString;
  asset?: string;
  saleType?: string;
  source?: string;
  data: Record<string, unknown>;
};

export type HistoryOptions = QueryWindow & {
  giftId: number;
  eventTypes?: string[];
  limit: number;
  cursor?: string;
};

export type SaleRow = {
  eventId: string;
  occurredAt: string;
  gift: PublicGift;
  price: DecimalString;
  asset: string;
  source: string;
};

export type AuctionRow = {
  auctionId: string;
  giftId?: number;
  gift?: PublicGift;
  startingBid?: DecimalString;
  asset?: string;
  startsAt?: string;
  endsAt?: string;
  status: string;
  latestBid?: DecimalString;
  latestBidAsset?: string;
  bidCount: number;
  winningBid?: DecimalString;
  createdEventId: string;
  lastEventId: string;
  cancelledAt?: string;
  finishedAt?: string;
};

export type AuctionBidRow = {
  eventId: string;
  auctionId: string;
  giftId: number;
  amount: DecimalString;
  asset: string;
  endsAt: string;
  occurredAt: string;
};

type RawRow = {
  event_id: string;
  type: string;
  occurred_at: string;
  receive_sequence: number;
  raw_payload: string;
};

type SaleDbRow = {
  event_id: string;
  occurred_at: string;
  gift_id: number;
  gift_num: number;
  gift_name: string;
  model: string;
  backdrop: string;
  symbol: string;
  price: string;
  asset: string;
  source: string;
};

type AuctionDbRow = {
  auction_id: string;
  gift_id: number | null;
  gift_json: string;
  starting_bid: string | null;
  asset: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  latest_bid: string | null;
  latest_bid_asset: string | null;
  bid_count: number;
  winning_bid: string | null;
  created_event_id: string;
  last_event_id: string;
  cancelled_at: string | null;
  finished_at: string | null;
};

type BidDbRow = {
  event_id: string;
  auction_id: string;
  gift_id: number;
  amount: string;
  asset: string;
  ends_at: string;
  occurred_at: string;
};

export class QueryRepository {
  constructor(private readonly db: SqliteDatabase) {}

  search(options: SearchOptions): {
    results: SearchObservation[];
    nextCursor: string | null;
  } {
    const sort = options.sort ?? "occurred_desc";
    const decodedCursor = decodeCursor(options.cursor);
    const order =
      sort === "occurred_asc" || sort === "price_asc" ? "ASC" : "DESC";
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (options.from) {
      where.push("occurred_at >= ?");
      params.push(options.from);
    }
    if (options.to) {
      where.push("occurred_at <= ?");
      params.push(options.to);
    }
    if (
      decodedCursor &&
      (sort === "occurred_asc" || sort === "occurred_desc")
    ) {
      where.push(
        order === "ASC"
          ? "(occurred_at > ? OR (occurred_at = ? AND receive_sequence > ?))"
          : "(occurred_at < ? OR (occurred_at = ? AND receive_sequence < ?))",
      );
      params.push(
        decodedCursor.occurredAt,
        decodedCursor.occurredAt,
        decodedCursor.receiveSequence,
      );
    }
    const scanLimit = Math.min(
      5_000,
      Math.max(options.limit * 20 + 1, options.limit + 1),
    );
    params.push(scanLimit);
    const rows = this.db
      .prepare(
        `SELECT event_id, type, occurred_at, receive_sequence, raw_payload
         FROM raw_events
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY occurred_at ${order}, receive_sequence ${order}
         LIMIT ?`,
      )
      .all(...params) as RawRow[];

    let results = rows
      .map((row) => this.toSearchObservation(row))
      .filter((row): row is SearchObservation => row !== undefined)
      .filter((row) => this.matchesSearch(row, options));
    if (sort === "price_asc" || sort === "price_desc") {
      results = results.sort((left, right) => {
        if (!left.price && !right.price)
          return left.occurredAt.localeCompare(right.occurredAt);
        if (!left.price) return 1;
        if (!right.price) return -1;
        const compared = compareDecimal(left.price, right.price);
        return sort === "price_asc" ? compared : -compared;
      });
    }
    const hasMoreRaw = rows.length === scanLimit;
    results = results.slice(0, options.limit);
    const lastRaw = rows.at(-1);
    return {
      results,
      nextCursor:
        hasMoreRaw && lastRaw
          ? encodeCursor({
              occurredAt: lastRaw.occurred_at,
              receiveSequence: lastRaw.receive_sequence,
            })
          : null,
    };
  }

  history(options: HistoryOptions): {
    results: SearchObservation[];
    nextCursor: string | null;
  } {
    const decodedCursor = decodeCursor(options.cursor);
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (options.from) {
      where.push("occurred_at >= ?");
      params.push(options.from);
    }
    if (options.to) {
      where.push("occurred_at <= ?");
      params.push(options.to);
    }
    if (decodedCursor) {
      where.push(
        "(occurred_at > ? OR (occurred_at = ? AND receive_sequence > ?))",
      );
      params.push(
        decodedCursor.occurredAt,
        decodedCursor.occurredAt,
        decodedCursor.receiveSequence,
      );
    }
    const scanLimit = Math.min(
      5_000,
      Math.max(options.limit * 20 + 1, options.limit + 1),
    );
    params.push(scanLimit);
    const rows = this.db
      .prepare(
        `SELECT event_id, type, occurred_at, receive_sequence, raw_payload
         FROM raw_events
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY occurred_at ASC, receive_sequence ASC
         LIMIT ?`,
      )
      .all(...params) as RawRow[];
    const results = rows
      .map((row) => this.toSearchObservation(row))
      .filter((row): row is SearchObservation => row !== undefined)
      .filter((row) => {
        if (options.eventTypes && !options.eventTypes.includes(row.type))
          return false;
        return containsGift(row.data, options.giftId);
      })
      .slice(0, options.limit);
    const lastRaw = rows.at(-1);
    return {
      results,
      nextCursor:
        rows.length === scanLimit && lastRaw
          ? encodeCursor({
              occurredAt: lastRaw.occurred_at,
              receiveSequence: lastRaw.receive_sequence,
            })
          : null,
    };
  }

  sales(
    options: QueryWindow & {
      giftId?: number;
      model?: string;
      backdrop?: string;
      symbol?: string;
      asset?: string;
      source?: string;
    },
  ): SaleRow[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (options.from) {
      where.push("occurred_at >= ?");
      params.push(options.from);
    }
    if (options.to) {
      where.push("occurred_at <= ?");
      params.push(options.to);
    }
    if (options.giftId !== undefined) {
      where.push("gift_id = ?");
      params.push(options.giftId);
    }
    if (options.model) {
      where.push("model = ?");
      params.push(options.model);
    }
    if (options.backdrop) {
      where.push("backdrop = ?");
      params.push(options.backdrop);
    }
    if (options.symbol) {
      where.push("symbol = ?");
      params.push(options.symbol);
    }
    if (options.asset) {
      where.push("asset = ?");
      params.push(options.asset);
    }
    if (options.source) {
      where.push("source = ?");
      params.push(options.source);
    }
    const rows = this.db
      .prepare(
        `SELECT event_id, occurred_at, gift_id, gift_num, gift_name, model, backdrop, symbol,
                price, asset, source
         FROM sale_facts
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY occurred_at ASC, event_id ASC`,
      )
      .all(...params) as SaleDbRow[];
    return rows.map((row) => ({
      eventId: row.event_id,
      occurredAt: row.occurred_at,
      gift: {
        gift_id: row.gift_id,
        gift_num: row.gift_num,
        gift_name: row.gift_name,
        model: row.model,
        backdrop: row.backdrop,
        symbol: row.symbol,
      },
      price: decimal(row.price),
      asset: row.asset,
      source: row.source,
    }));
  }

  listAuctions(options: {
    auctionId?: string;
    giftId?: number;
    status?: string;
    endsFrom?: string;
    endsTo?: string;
    limit: number;
  }): AuctionRow[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (options.auctionId) {
      where.push("auction_id = ?");
      params.push(options.auctionId);
    }
    if (options.giftId !== undefined) {
      where.push("gift_id = ?");
      params.push(options.giftId);
    }
    if (options.status) {
      where.push("status = ?");
      params.push(options.status);
    }
    if (options.endsFrom) {
      where.push("ends_at >= ?");
      params.push(options.endsFrom);
    }
    if (options.endsTo) {
      where.push("ends_at <= ?");
      params.push(options.endsTo);
    }
    params.push(options.limit);
    const rows = this.db
      .prepare(
        `SELECT auction_id, gift_id, gift_json, starting_bid, asset, starts_at, ends_at, status,
                latest_bid, latest_bid_asset, bid_count, winning_bid, created_event_id,
                last_event_id, cancelled_at, finished_at
         FROM auctions
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY COALESCE(ends_at, '9999-12-31T23:59:59.999Z') ASC, auction_id ASC
         LIMIT ?`,
      )
      .all(...params) as AuctionDbRow[];
    return rows.map(toAuctionRow);
  }

  auctionBids(auctionId: string): AuctionBidRow[] {
    const rows = this.db
      .prepare(
        `SELECT event_id, auction_id, gift_id, amount, asset, ends_at, occurred_at
         FROM auction_bids WHERE auction_id = ? ORDER BY occurred_at ASC, event_id ASC`,
      )
      .all(auctionId) as BidDbRow[];
    return rows.map((row) => ({
      eventId: row.event_id,
      auctionId: row.auction_id,
      giftId: row.gift_id,
      amount: decimal(row.amount),
      asset: row.asset,
      endsAt: row.ends_at,
      occurredAt: row.occurred_at,
    }));
  }

  statsSince(from: string): {
    eventCount: number;
    saleCount: number;
    listingCount: number;
    auctionCount: number;
    offerCount: number;
    assets: string[];
  } {
    const raw = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM raw_events WHERE occurred_at >= ?",
      )
      .get(from) as { count: number };
    const sales = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM sale_facts WHERE occurred_at >= ?",
      )
      .get(from) as { count: number };
    const listings = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM listing_observations
         WHERE occurred_at >= ? AND observation_type IN ('created', 'price_changed')`,
      )
      .get(from) as { count: number };
    const auctions = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM auctions WHERE last_event_id IN (SELECT event_id FROM raw_events WHERE occurred_at >= ?)",
      )
      .get(from) as { count: number };
    const offers = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM buy_offers WHERE occurred_at >= ?",
      )
      .get(from) as { count: number };
    const assets = this.db
      .prepare(
        "SELECT DISTINCT asset FROM sale_facts WHERE occurred_at >= ? ORDER BY asset",
      )
      .all(from)
      .map((row) => (row as { asset: string }).asset);
    return {
      eventCount: raw.count,
      saleCount: sales.count,
      listingCount: listings.count,
      auctionCount: auctions.count,
      offerCount: offers.count,
      assets,
    };
  }

  private toSearchObservation(row: RawRow): SearchObservation | undefined {
    let payload: unknown;
    try {
      payload = JSON.parse(row.raw_payload) as unknown;
    } catch {
      return undefined;
    }
    if (!isRecord(payload) || !isRecord(payload.data)) return undefined;
    const data = payload.data;
    const gift = isRecord(data.gift) ? toGift(data.gift) : undefined;
    const price = extractPrice(row.type, data);
    return {
      eventId: row.event_id,
      type: row.type,
      occurredAt: row.occurred_at,
      ...(gift ? { gift } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(typeof data.asset === "string" ? { asset: data.asset } : {}),
      ...(typeof data.sale_type === "string"
        ? { saleType: data.sale_type }
        : {}),
      ...(typeof data.source === "string" ? { source: data.source } : {}),
      data,
    };
  }

  private matchesSearch(
    row: SearchObservation,
    options: SearchOptions,
  ): boolean {
    if (options.eventTypes && !options.eventTypes.includes(row.type))
      return false;
    if (
      options.giftId !== undefined &&
      row.gift?.gift_id !== options.giftId &&
      !containsGift(row.data, options.giftId)
    )
      return false;
    if (options.giftNum !== undefined && row.gift?.gift_num !== options.giftNum)
      return false;
    if (
      options.giftName &&
      !includesIgnoreCase(row.gift?.gift_name, options.giftName)
    )
      return false;
    if (options.model && !includesIgnoreCase(row.gift?.model, options.model))
      return false;
    if (
      options.backdrop &&
      !includesIgnoreCase(row.gift?.backdrop, options.backdrop)
    )
      return false;
    if (options.symbol && !includesIgnoreCase(row.gift?.symbol, options.symbol))
      return false;
    if (options.asset && row.asset !== options.asset) return false;
    if (options.saleType && row.saleType !== options.saleType) return false;
    if (options.source && row.source !== options.source) return false;
    if (
      options.minPrice !== undefined &&
      (!row.price || compareDecimal(row.price, options.minPrice) < 0)
    )
      return false;
    if (
      options.maxPrice !== undefined &&
      (!row.price || compareDecimal(row.price, options.maxPrice) > 0)
    )
      return false;
    return true;
  }
}

function toAuctionRow(row: AuctionDbRow): AuctionRow {
  const gift = parseGift(row.gift_json);
  return {
    auctionId: row.auction_id,
    ...(row.gift_id !== null ? { giftId: row.gift_id } : {}),
    ...(gift ? { gift } : {}),
    ...(row.starting_bid !== null
      ? { startingBid: decimal(row.starting_bid) }
      : {}),
    ...(row.asset !== null ? { asset: row.asset } : {}),
    ...(row.starts_at !== null ? { startsAt: row.starts_at } : {}),
    ...(row.ends_at !== null ? { endsAt: row.ends_at } : {}),
    status: row.status,
    ...(row.latest_bid !== null ? { latestBid: decimal(row.latest_bid) } : {}),
    ...(row.latest_bid_asset !== null
      ? { latestBidAsset: row.latest_bid_asset }
      : {}),
    bidCount: row.bid_count,
    ...(row.winning_bid !== null
      ? { winningBid: decimal(row.winning_bid) }
      : {}),
    createdEventId: row.created_event_id,
    lastEventId: row.last_event_id,
    ...(row.cancelled_at !== null ? { cancelledAt: row.cancelled_at } : {}),
    ...(row.finished_at !== null ? { finishedAt: row.finished_at } : {}),
  };
}

function extractPrice(
  type: string,
  data: Record<string, unknown>,
): DecimalString | undefined {
  const candidate =
    typeof data.price === "number" || typeof data.price === "string"
      ? data.price
      : typeof data.counter_price === "number" ||
          typeof data.counter_price === "string"
        ? data.counter_price
        : typeof data.amount === "number" || typeof data.amount === "string"
          ? data.amount
          : typeof data.winning_bid === "number" ||
              typeof data.winning_bid === "string"
            ? data.winning_bid
            : typeof data.starting_bid === "number" ||
                typeof data.starting_bid === "string"
              ? data.starting_bid
              : undefined;
  if (candidate === undefined || type === "listing.promotion_ended")
    return undefined;
  try {
    return decimal(candidate);
  } catch {
    return undefined;
  }
}

function toGift(value: Record<string, unknown>): PublicGift | undefined {
  if (
    typeof value.gift_id !== "number" ||
    typeof value.gift_num !== "number" ||
    typeof value.gift_name !== "string" ||
    typeof value.model !== "string" ||
    typeof value.backdrop !== "string" ||
    typeof value.symbol !== "string"
  ) {
    return undefined;
  }
  return {
    gift_id: value.gift_id,
    gift_num: value.gift_num,
    gift_name: value.gift_name,
    model: value.model,
    backdrop: value.backdrop,
    symbol: value.symbol,
  };
}

function parseGift(value: string): PublicGift | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? toGift(parsed) : undefined;
  } catch {
    return undefined;
  }
}

function containsGift(data: Record<string, unknown>, giftId: number): boolean {
  if (isRecord(data.gift) && data.gift.gift_id === giftId) return true;
  for (const key of [
    "gift_id",
    "gift_ids",
    "requested_gift_ids",
    "offered_gift_ids",
  ]) {
    const value = data[key];
    if (value === giftId) return true;
    if (Array.isArray(value) && value.includes(giftId)) return true;
  }
  return false;
}

function includesIgnoreCase(value: string | undefined, query: string): boolean {
  return (
    value?.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ?? false
  );
}

type Cursor = { occurredAt: string; receiveSequence: number };

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): Cursor | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown;
    if (
      isRecord(parsed) &&
      typeof parsed.occurredAt === "string" &&
      typeof parsed.receiveSequence === "number" &&
      Number.isInteger(parsed.receiveSequence)
    ) {
      return {
        occurredAt: parsed.occurredAt,
        receiveSequence: parsed.receiveSequence,
      };
    }
  } catch {
    // Fall through to a stable validation error in callers when needed.
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
