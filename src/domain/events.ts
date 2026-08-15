export const EVENT_TYPES = [
  "gift.indexed",
  "listing.created",
  "listing.price_changed",
  "listing.cancelled",
  "listing.promoted",
  "listing.promotion_ended",
  "sale.completed",
  "auction.created",
  "auction.bid_placed",
  "auction.extended",
  "auction.cancelled",
  "auction.finished",
  "buy_offer.created",
  "buy_offer.countered",
  "buy_offer.accepted",
  "buy_offer.rejected",
  "buy_offer.cancelled",
  "premarket.listing_created",
  "premarket.sale_completed",
  "premarket.listing_cancelled",
  "premarket.settled",
  "bundle.created",
  "bundle.debundled",
  "trade.created",
  "trade.offer_created",
  "trade.completed",
  "trade.cancelled",
] as const;

export type KnownEventType = (typeof EVENT_TYPES)[number];
export type MarketplaceEventType = KnownEventType | (string & {});

export const SALE_SOURCES = [
  "LISTING",
  "DUTCH",
  "BUY_OFFER",
  "AUCTION",
] as const;
export type SaleSource = (typeof SALE_SOURCES)[number];

export const SALE_TYPES = ["FIXED", "DUTCH"] as const;
export type SaleType = (typeof SALE_TYPES)[number];

export const ASSET_NAMES = ["TON", "TONNEL", "USDT"] as const;
export type Asset = (typeof ASSET_NAMES)[number] | (string & {});

export type PublicGift = {
  gift_id: number;
  gift_num: number;
  gift_name: string;
  model: string;
  backdrop: string;
  symbol: string;
};

export type DutchListing = {
  start_price: number;
  minimum_price: number;
  drop_percent: number;
  interval_minutes: number;
  starts_at: string;
};

export type GiftIndexedData = {
  gift: PublicGift;
  market?: "PREMARKET";
};

export type ListingCreatedData = {
  gift: PublicGift;
  price: number;
  asset: Asset;
  sale_type: SaleType;
  dutch?: DutchListing;
};

export type ListingPriceChangedData = {
  gift: PublicGift;
  previous_price: number;
  price: number;
  asset: Asset;
};

export type ListingCancelledData = {
  gift: PublicGift;
  price: number;
  asset: Asset;
  sale_type: SaleType;
};

export type ListingPromotedData = {
  gift: PublicGift;
  target: "LISTING" | "AUCTION";
  auction_id?: string;
  promotion_started_at?: string;
};

export type ListingPromotionEndedData = {
  target: "LISTING" | "AUCTION";
  count: number;
  expired_before: string;
};

export type SaleCompletedData = {
  gift: PublicGift;
  price: number;
  asset: Asset;
  source: SaleSource;
};

export type AuctionCreatedData = {
  auction_id: string;
  gift: PublicGift;
  starting_bid: number;
  asset: Asset;
  starts_at: string;
  ends_at: string;
};

export type AuctionBidPlacedData = {
  auction_id: string;
  gift: PublicGift;
  amount: number;
  asset: Asset;
  ends_at: string;
};

export type AuctionExtendedData = {
  auction_id: string;
  gift_id: number;
  previous_ends_at: string;
  ends_at: string;
};

export type AuctionCancelledData = {
  auction_id: string;
  gift_id: number;
};

export type AuctionFinishedData =
  | {
      auction_id: string;
      status: "SOLD";
      gift: PublicGift;
      winning_bid: number;
      asset: Asset;
    }
  | {
      auction_id: string;
      status: "NO_BIDS";
      gift_id: number;
    };

export type BuyOfferCreatedData = {
  offer_id: string;
  gift: PublicGift;
  price: number;
  asset: Asset;
};

export type BuyOfferCounteredData = {
  offer_id: string;
  gift: PublicGift;
  original_price: number;
  counter_price: number;
  asset: Asset;
};

export type BuyOfferDecisionData = {
  offer_id: string;
  gift_id: number;
  price: number;
  asset: Asset;
  stage: "OFFER" | "COUNTER";
};

export type PremarketListingCreatedData = {
  gift: PublicGift;
  price: number;
  asset: Asset;
};

export type PremarketSaleCompletedData = {
  gift: PublicGift;
  price: number;
  price_with_fee: number;
  asset: Asset;
};

export type PremarketListingCancelledData = {
  gift: PublicGift;
  previous_price: number;
  asset: Asset;
};

export type PremarketSettledData = {
  gift: PublicGift;
  status: "COMPLETED";
  amount: number;
  asset: Asset;
};

export type BundleData = {
  bundle_id: string;
  gift_ids: number[];
};

export type TradeCreatedData = {
  trade_id: string;
  gift_ids: number[];
  amount: number;
  asset: Asset;
};

export type TradeOfferCreatedData = {
  trade_id: string;
  offer_id: string;
  gift_ids: number[];
  amount: number;
  asset: Asset;
};

export type TradeCompletedData = {
  trade_id: string;
  offer_id: string;
  requested_gift_ids: number[];
  offered_gift_ids: number[];
  requested_amount: number;
  requested_asset: Asset;
  offered_amount: number;
  offered_asset: Asset;
};

export type TradeCancelledData = {
  trade_id: string;
  gift_ids: number[];
};

export type EventDataByType = {
  "gift.indexed": GiftIndexedData;
  "listing.created": ListingCreatedData;
  "listing.price_changed": ListingPriceChangedData;
  "listing.cancelled": ListingCancelledData;
  "listing.promoted": ListingPromotedData;
  "listing.promotion_ended": ListingPromotionEndedData;
  "sale.completed": SaleCompletedData;
  "auction.created": AuctionCreatedData;
  "auction.bid_placed": AuctionBidPlacedData;
  "auction.extended": AuctionExtendedData;
  "auction.cancelled": AuctionCancelledData;
  "auction.finished": AuctionFinishedData;
  "buy_offer.created": BuyOfferCreatedData;
  "buy_offer.countered": BuyOfferCounteredData;
  "buy_offer.accepted": BuyOfferDecisionData;
  "buy_offer.rejected": BuyOfferDecisionData;
  "buy_offer.cancelled": BuyOfferDecisionData;
  "premarket.listing_created": PremarketListingCreatedData;
  "premarket.sale_completed": PremarketSaleCompletedData;
  "premarket.listing_cancelled": PremarketListingCancelledData;
  "premarket.settled": PremarketSettledData;
  "bundle.created": BundleData;
  "bundle.debundled": BundleData;
  "trade.created": TradeCreatedData;
  "trade.offer_created": TradeOfferCreatedData;
  "trade.completed": TradeCompletedData;
  "trade.cancelled": TradeCancelledData;
};

export type MarketplaceEvent<K extends KnownEventType = KnownEventType> = {
  eventId: string;
  version: 1;
  type: K;
  occurredAt: string;
  data: EventDataByType[K];
};

export type KnownMarketplaceEvent = {
  [K in KnownEventType]: MarketplaceEvent<K>;
}[KnownEventType];

export type UnknownMarketplaceEvent = {
  eventId: string;
  version: 1;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
};

export type AnyMarketplaceEvent =
  KnownMarketplaceEvent | UnknownMarketplaceEvent;

export type ConnectedMessage = {
  type: "marketplace.connected";
  version: 1;
  serverTime: string;
  replayEndpoint: string;
};

export type MarketplaceMessage = AnyMarketplaceEvent | ConnectedMessage;

export type ReceiveContext = {
  receivedAt: string;
  receiveSequence: number;
};

export type RawEventRecord = {
  eventId: string;
  version: number;
  type: string;
  occurredAt: string;
  receivedAt: string;
  receiveSequence: number;
  payload: string;
  processingStatus: "processed" | "failed";
  correlationId: string;
};

export function isKnownEventType(type: string): type is KnownEventType {
  return (EVENT_TYPES as readonly string[]).includes(type);
}

export function isMarketplaceEvent(
  message: MarketplaceMessage,
): message is AnyMarketplaceEvent {
  return "eventId" in message;
}
