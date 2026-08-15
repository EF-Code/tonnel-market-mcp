import {
  isKnownEventType,
  type AnyMarketplaceEvent,
  type PublicGift,
  type KnownMarketplaceEvent,
} from "../domain/events.js";
import { decimal } from "../domain/money.js";
import type { SqliteDatabase } from "./database.js";

function json(value: unknown): string {
  return JSON.stringify(value);
}

function giftJson(gift: PublicGift): string {
  return json(gift);
}

export class ProjectionRepository {
  apply(db: SqliteDatabase, event: AnyMarketplaceEvent): void {
    if (!isKnownEventType(event.type)) return;
    const knownEvent = event as KnownMarketplaceEvent;

    switch (knownEvent.type) {
      case "gift.indexed":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        return;
      case "listing.created":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.insertListing(db, knownEvent, "created", {
          price: decimal(knownEvent.data.price),
          asset: knownEvent.data.asset,
          saleType: knownEvent.data.sale_type,
          dutch: knownEvent.data.dutch,
        });
        return;
      case "listing.price_changed":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.insertListing(db, knownEvent, "price_changed", {
          price: decimal(knownEvent.data.price),
          previousPrice: decimal(knownEvent.data.previous_price),
          asset: knownEvent.data.asset,
        });
        return;
      case "listing.cancelled":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.insertListing(db, knownEvent, "cancelled", {
          price: decimal(knownEvent.data.price),
          asset: knownEvent.data.asset,
          saleType: knownEvent.data.sale_type,
        });
        return;
      case "listing.promoted":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.insertListing(db, knownEvent, "promoted", {
          promotionTarget: knownEvent.data.target,
          ...(knownEvent.data.auction_id
            ? { auctionId: knownEvent.data.auction_id }
            : {}),
        });
        return;
      case "listing.promotion_ended":
        this.insertListing(db, knownEvent, "promotion_ended", {
          promotionTarget: knownEvent.data.target,
        });
        return;
      case "sale.completed":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.insertSale(db, knownEvent);
        return;
      case "auction.created":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.insertAuctionCreated(db, knownEvent);
        return;
      case "auction.bid_placed":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.ensureAuction(db, {
          auctionId: knownEvent.data.auction_id,
          giftId: knownEvent.data.gift.gift_id,
          giftJson: giftJson(knownEvent.data.gift),
          eventId: knownEvent.eventId,
          occurredAt: knownEvent.occurredAt,
          asset: knownEvent.data.asset,
          endsAt: knownEvent.data.ends_at,
        });
        db.prepare(
          `INSERT INTO auction_bids
           (event_id, auction_id, gift_id, amount, asset, ends_at, occurred_at, raw_data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          knownEvent.eventId,
          knownEvent.data.auction_id,
          knownEvent.data.gift.gift_id,
          decimal(knownEvent.data.amount),
          knownEvent.data.asset,
          knownEvent.data.ends_at,
          knownEvent.occurredAt,
          json(knownEvent.data),
        );
        db.prepare(
          `UPDATE auctions
           SET latest_bid = ?, latest_bid_asset = ?, bid_count = bid_count + 1,
               ends_at = ?, last_event_id = ?
           WHERE auction_id = ?`,
        ).run(
          decimal(knownEvent.data.amount),
          knownEvent.data.asset,
          knownEvent.data.ends_at,
          knownEvent.eventId,
          knownEvent.data.auction_id,
        );
        return;
      case "auction.extended":
        this.ensureAuction(db, {
          auctionId: knownEvent.data.auction_id,
          giftId: knownEvent.data.gift_id,
          giftJson: json({ gift_id: knownEvent.data.gift_id }),
          eventId: knownEvent.eventId,
          occurredAt: knownEvent.occurredAt,
          endsAt: knownEvent.data.ends_at,
        });
        db.prepare(
          `UPDATE auctions SET ends_at = ?, last_event_id = ? WHERE auction_id = ?`,
        ).run(
          knownEvent.data.ends_at,
          knownEvent.eventId,
          knownEvent.data.auction_id,
        );
        return;
      case "auction.cancelled":
        this.ensureAuction(db, {
          auctionId: knownEvent.data.auction_id,
          giftId: knownEvent.data.gift_id,
          giftJson: json({ gift_id: knownEvent.data.gift_id }),
          eventId: knownEvent.eventId,
          occurredAt: knownEvent.occurredAt,
        });
        db.prepare(
          `UPDATE auctions
           SET status = 'CANCELLED', cancelled_at = ?, last_event_id = ?
           WHERE auction_id = ?`,
        ).run(
          knownEvent.occurredAt,
          knownEvent.eventId,
          knownEvent.data.auction_id,
        );
        return;
      case "auction.finished":
        if (knownEvent.data.status === "SOLD") {
          this.upsertGift(
            db,
            knownEvent.data.gift,
            knownEvent.occurredAt,
            knownEvent.eventId,
          );
          this.ensureAuction(db, {
            auctionId: knownEvent.data.auction_id,
            giftId: knownEvent.data.gift.gift_id,
            giftJson: giftJson(knownEvent.data.gift),
            eventId: knownEvent.eventId,
            occurredAt: knownEvent.occurredAt,
            asset: knownEvent.data.asset,
          });
          db.prepare(
            `UPDATE auctions
             SET status = 'SOLD', winning_bid = ?, latest_bid = ?, latest_bid_asset = ?,
                 finished_at = ?, last_event_id = ?, gift_id = ?, gift_json = ?, asset = ?
             WHERE auction_id = ?`,
          ).run(
            decimal(knownEvent.data.winning_bid),
            decimal(knownEvent.data.winning_bid),
            knownEvent.data.asset,
            knownEvent.occurredAt,
            knownEvent.eventId,
            knownEvent.data.gift.gift_id,
            giftJson(knownEvent.data.gift),
            knownEvent.data.asset,
            knownEvent.data.auction_id,
          );
        } else {
          this.ensureAuction(db, {
            auctionId: knownEvent.data.auction_id,
            giftId: knownEvent.data.gift_id,
            giftJson: json({ gift_id: knownEvent.data.gift_id }),
            eventId: knownEvent.eventId,
            occurredAt: knownEvent.occurredAt,
          });
          db.prepare(
            `UPDATE auctions SET status = 'NO_BIDS', finished_at = ?, last_event_id = ? WHERE auction_id = ?`,
          ).run(
            knownEvent.occurredAt,
            knownEvent.eventId,
            knownEvent.data.auction_id,
          );
        }
        return;
      case "buy_offer.created":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.insertOffer(db, knownEvent, "created", {
          giftId: knownEvent.data.gift.gift_id,
          giftJson: giftJson(knownEvent.data.gift),
          price: decimal(knownEvent.data.price),
          asset: knownEvent.data.asset,
        });
        return;
      case "buy_offer.countered":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.insertOffer(db, knownEvent, "countered", {
          giftId: knownEvent.data.gift.gift_id,
          giftJson: giftJson(knownEvent.data.gift),
          originalPrice: decimal(knownEvent.data.original_price),
          counterPrice: decimal(knownEvent.data.counter_price),
          asset: knownEvent.data.asset,
        });
        return;
      case "buy_offer.accepted":
      case "buy_offer.rejected":
      case "buy_offer.cancelled":
        this.insertOffer(
          db,
          knownEvent,
          knownEvent.type.slice("buy_offer.".length) as
            "accepted" | "rejected" | "cancelled",
          {
            giftId: knownEvent.data.gift_id,
            giftJson: json({ gift_id: knownEvent.data.gift_id }),
            price: decimal(knownEvent.data.price),
            asset: knownEvent.data.asset,
            ...("stage" in knownEvent.data
              ? { stage: knownEvent.data.stage }
              : {}),
          },
        );
        return;
      case "premarket.listing_created":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.insertPremarket(db, knownEvent, "listing_created", {
          giftId: knownEvent.data.gift.gift_id,
          giftJson: giftJson(knownEvent.data.gift),
          price: decimal(knownEvent.data.price),
          asset: knownEvent.data.asset,
        });
        return;
      case "premarket.sale_completed":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.insertPremarket(db, knownEvent, "sale_completed", {
          giftId: knownEvent.data.gift.gift_id,
          giftJson: giftJson(knownEvent.data.gift),
          price: decimal(knownEvent.data.price),
          priceWithFee: decimal(knownEvent.data.price_with_fee),
          asset: knownEvent.data.asset,
        });
        return;
      case "premarket.listing_cancelled":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.insertPremarket(db, knownEvent, "listing_cancelled", {
          giftId: knownEvent.data.gift.gift_id,
          giftJson: giftJson(knownEvent.data.gift),
          previousPrice: decimal(knownEvent.data.previous_price),
          asset: knownEvent.data.asset,
        });
        return;
      case "premarket.settled":
        this.upsertGift(
          db,
          knownEvent.data.gift,
          knownEvent.occurredAt,
          knownEvent.eventId,
        );
        this.insertPremarket(db, knownEvent, "settled", {
          giftId: knownEvent.data.gift.gift_id,
          giftJson: giftJson(knownEvent.data.gift),
          amount: decimal(knownEvent.data.amount),
          asset: knownEvent.data.asset,
          status: knownEvent.data.status,
        });
        return;
      case "bundle.created":
      case "bundle.debundled":
        db.prepare(
          `INSERT INTO bundles (event_id, bundle_id, gift_ids_json, observation_type, occurred_at, raw_data)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          knownEvent.eventId,
          knownEvent.data.bundle_id,
          json(knownEvent.data.gift_ids),
          knownEvent.type === "bundle.created" ? "created" : "debundled",
          knownEvent.occurredAt,
          json(knownEvent.data),
        );
        return;
      case "trade.created":
      case "trade.offer_created":
      case "trade.completed":
      case "trade.cancelled":
        this.insertTrade(db, knownEvent);
        return;
    }
  }

  private upsertGift(
    db: SqliteDatabase,
    gift: PublicGift,
    occurredAt: string,
    eventId: string,
  ): void {
    db.prepare(
      `INSERT INTO gifts
       (gift_id, gift_num, gift_name, model, backdrop, symbol, first_seen_at, last_seen_at, last_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(gift_id) DO UPDATE SET
         gift_num = excluded.gift_num,
         gift_name = excluded.gift_name,
         model = excluded.model,
         backdrop = excluded.backdrop,
         symbol = excluded.symbol,
         first_seen_at = MIN(gifts.first_seen_at, excluded.first_seen_at),
         last_seen_at = MAX(gifts.last_seen_at, excluded.last_seen_at),
         last_event_id = excluded.last_event_id`,
    ).run(
      gift.gift_id,
      gift.gift_num,
      gift.gift_name,
      gift.model,
      gift.backdrop,
      gift.symbol,
      occurredAt,
      occurredAt,
      eventId,
    );
  }

  private insertListing(
    db: SqliteDatabase,
    event: KnownMarketplaceEvent,
    observationType:
      | "created"
      | "price_changed"
      | "cancelled"
      | "promoted"
      | "promotion_ended",
    fields: {
      price?: string;
      previousPrice?: string;
      asset?: string;
      saleType?: string;
      promotionTarget?: string;
      auctionId?: string;
      dutch?: unknown;
    },
  ): void {
    const data = event.data as Partial<{
      gift: PublicGift;
    }>;
    const gift = data.gift;
    db.prepare(
      `INSERT INTO listing_observations
       (event_id, gift_id, gift_num, gift_name, model, backdrop, symbol, observation_type,
        price, previous_price, asset, sale_type, promotion_target, auction_id, dutch_json, occurred_at, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.eventId,
      gift?.gift_id ?? null,
      gift?.gift_num ?? null,
      gift?.gift_name ?? null,
      gift?.model ?? null,
      gift?.backdrop ?? null,
      gift?.symbol ?? null,
      observationType,
      fields.price ?? null,
      fields.previousPrice ?? null,
      fields.asset ?? null,
      fields.saleType ?? null,
      fields.promotionTarget ?? null,
      fields.auctionId ?? null,
      fields.dutch ? json(fields.dutch) : null,
      event.occurredAt,
      json(event.data),
    );
  }

  private insertSale(
    db: SqliteDatabase,
    event: KnownMarketplaceEvent & { type: "sale.completed" },
  ): void {
    db.prepare(
      `INSERT INTO sale_facts
       (event_id, gift_id, gift_num, gift_name, model, backdrop, symbol, price, asset, source, occurred_at, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.eventId,
      event.data.gift.gift_id,
      event.data.gift.gift_num,
      event.data.gift.gift_name,
      event.data.gift.model,
      event.data.gift.backdrop,
      event.data.gift.symbol,
      decimal(event.data.price),
      event.data.asset,
      event.data.source,
      event.occurredAt,
      json(event.data),
    );
  }

  private insertAuctionCreated(
    db: SqliteDatabase,
    event: KnownMarketplaceEvent & { type: "auction.created" },
  ): void {
    db.prepare(
      `INSERT INTO auctions
       (auction_id, gift_id, gift_json, starting_bid, asset, starts_at, ends_at, status,
        created_event_id, last_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
       ON CONFLICT(auction_id) DO UPDATE SET
         gift_id = excluded.gift_id,
         gift_json = excluded.gift_json,
         starting_bid = excluded.starting_bid,
         asset = excluded.asset,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         last_event_id = excluded.last_event_id`,
    ).run(
      event.data.auction_id,
      event.data.gift.gift_id,
      giftJson(event.data.gift),
      decimal(event.data.starting_bid),
      event.data.asset,
      event.data.starts_at,
      event.data.ends_at,
      event.eventId,
      event.eventId,
    );
  }

  private ensureAuction(
    db: SqliteDatabase,
    values: {
      auctionId: string;
      giftId: number;
      giftJson: string;
      eventId: string;
      occurredAt: string;
      asset?: string;
      endsAt?: string;
    },
  ): void {
    db.prepare(
      `INSERT OR IGNORE INTO auctions
       (auction_id, gift_id, gift_json, asset, ends_at, status, created_event_id, last_event_id)
       VALUES (?, ?, ?, ?, ?, 'UNKNOWN', ?, ?)`,
    ).run(
      values.auctionId,
      values.giftId,
      values.giftJson,
      values.asset ?? null,
      values.endsAt ?? null,
      values.eventId,
      values.eventId,
    );
  }

  private insertOffer(
    db: SqliteDatabase,
    event: KnownMarketplaceEvent,
    observationType:
      "created" | "countered" | "accepted" | "rejected" | "cancelled",
    fields: {
      giftId: number;
      giftJson: string;
      price?: string;
      originalPrice?: string;
      counterPrice?: string;
      asset: string;
      stage?: "OFFER" | "COUNTER";
    },
  ): void {
    const data = event.data as { offer_id: string };
    db.prepare(
      `INSERT INTO buy_offers
       (event_id, offer_id, gift_id, gift_json, observation_type, price, original_price,
        counter_price, asset, stage, occurred_at, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.eventId,
      data.offer_id,
      fields.giftId,
      fields.giftJson,
      observationType,
      fields.price ?? null,
      fields.originalPrice ?? null,
      fields.counterPrice ?? null,
      fields.asset,
      fields.stage ?? null,
      event.occurredAt,
      json(event.data),
    );
  }

  private insertPremarket(
    db: SqliteDatabase,
    event: KnownMarketplaceEvent,
    observationType:
      "listing_created" | "sale_completed" | "listing_cancelled" | "settled",
    fields: {
      giftId: number;
      giftJson: string;
      price?: string;
      priceWithFee?: string;
      previousPrice?: string;
      amount?: string;
      asset: string;
      status?: string;
    },
  ): void {
    db.prepare(
      `INSERT INTO premarket_facts
       (event_id, gift_id, gift_json, observation_type, price, price_with_fee, previous_price,
        amount, asset, status, occurred_at, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.eventId,
      fields.giftId,
      fields.giftJson,
      observationType,
      fields.price ?? null,
      fields.priceWithFee ?? null,
      fields.previousPrice ?? null,
      fields.amount ?? null,
      fields.asset,
      fields.status ?? null,
      event.occurredAt,
      json(event.data),
    );
  }

  private insertTrade(db: SqliteDatabase, event: KnownMarketplaceEvent): void {
    const data = event.data as Record<string, unknown>;
    const type = event.type;
    const giftIds = Array.isArray(data.gift_ids) ? data.gift_ids : [];
    db.prepare(
      `INSERT INTO trades
       (event_id, trade_id, offer_id, observation_type, gift_ids_json, requested_gift_ids_json,
        offered_gift_ids_json, amount, asset, requested_amount, requested_asset,
        offered_amount, offered_asset, occurred_at, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.eventId,
      data.trade_id,
      typeof data.offer_id === "string" ? data.offer_id : null,
      type.replace("trade.", ""),
      json(giftIds),
      Array.isArray(data.requested_gift_ids)
        ? json(data.requested_gift_ids)
        : null,
      Array.isArray(data.offered_gift_ids) ? json(data.offered_gift_ids) : null,
      typeof data.amount === "number" ? decimal(data.amount) : null,
      typeof data.asset === "string" ? data.asset : null,
      typeof data.requested_amount === "number"
        ? decimal(data.requested_amount)
        : null,
      typeof data.requested_asset === "string" ? data.requested_asset : null,
      typeof data.offered_amount === "number"
        ? decimal(data.offered_amount)
        : null,
      typeof data.offered_asset === "string" ? data.offered_asset : null,
      event.occurredAt,
      json(event.data),
    );
  }
}
