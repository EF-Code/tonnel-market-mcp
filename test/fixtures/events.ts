import { EVENT_TYPES, type AnyMarketplaceEvent, type KnownEventType, type PublicGift } from '../../src/domain/events.js';
import { parseMarketplaceEvent, parseMarketplaceMessage } from '../../src/domain/schemas.js';

export const fixtureGift: PublicGift = {
  gift_id: 123,
  gift_num: 456,
  gift_name: "Durov's Cap",
  model: 'Freshwave (2%)',
  backdrop: 'Black (4%)',
  symbol: 'Star (1%)',
};

const fixtureData: Record<KnownEventType, Record<string, unknown>> = {
  'gift.indexed': { gift: fixtureGift },
  'listing.created': { gift: fixtureGift, price: 10.5, asset: 'TON', sale_type: 'FIXED' },
  'listing.price_changed': { gift: fixtureGift, previous_price: 12, price: 10.5, asset: 'TON' },
  'listing.cancelled': { gift: fixtureGift, price: 10.5, asset: 'TON', sale_type: 'FIXED' },
  'listing.promoted': { gift: fixtureGift, target: 'LISTING', promotion_started_at: '2026-08-15T00:00:00.000Z' },
  'listing.promotion_ended': { target: 'LISTING', count: 2, expired_before: '2026-08-15T00:00:00.000Z' },
  'sale.completed': { gift: fixtureGift, price: 11, asset: 'TON', source: 'LISTING' },
  'auction.created': {
    auction_id: 'auction-1',
    gift: fixtureGift,
    starting_bid: 8,
    asset: 'TON',
    starts_at: '2026-08-15T00:00:00.000Z',
    ends_at: '2026-08-15T01:00:00.000Z',
  },
  'auction.bid_placed': {
    auction_id: 'auction-1',
    gift: fixtureGift,
    amount: 9,
    asset: 'TON',
    ends_at: '2026-08-15T01:00:00.000Z',
  },
  'auction.extended': {
    auction_id: 'auction-1',
    gift_id: fixtureGift.gift_id,
    previous_ends_at: '2026-08-15T01:00:00.000Z',
    ends_at: '2026-08-15T01:05:00.000Z',
  },
  'auction.cancelled': { auction_id: 'auction-1', gift_id: fixtureGift.gift_id },
  'auction.finished': {
    auction_id: 'auction-1',
    status: 'SOLD',
    gift: fixtureGift,
    winning_bid: 9,
    asset: 'TON',
  },
  'buy_offer.created': { offer_id: 'offer-1', gift: fixtureGift, price: 7, asset: 'TON' },
  'buy_offer.countered': {
    offer_id: 'offer-1',
    gift: fixtureGift,
    original_price: 7,
    counter_price: 7.5,
    asset: 'TON',
  },
  'buy_offer.accepted': {
    offer_id: 'offer-1',
    gift_id: fixtureGift.gift_id,
    price: 7.5,
    asset: 'TON',
    stage: 'COUNTER',
  },
  'buy_offer.rejected': {
    offer_id: 'offer-1',
    gift_id: fixtureGift.gift_id,
    price: 7.5,
    asset: 'TON',
    stage: 'COUNTER',
  },
  'buy_offer.cancelled': { offer_id: 'offer-1', gift_id: fixtureGift.gift_id, price: 7.5, asset: 'TON' },
  'premarket.listing_created': { gift: fixtureGift, price: 5, asset: 'TON' },
  'premarket.sale_completed': { gift: fixtureGift, price: 5, price_with_fee: 5.25, asset: 'TON' },
  'premarket.listing_cancelled': { gift: fixtureGift, previous_price: 5, asset: 'TON' },
  'premarket.settled': { gift: fixtureGift, status: 'COMPLETED', amount: 5, asset: 'TON' },
  'bundle.created': { bundle_id: 'bundle-1', gift_ids: [fixtureGift.gift_id] },
  'bundle.debundled': { bundle_id: 'bundle-1', gift_ids: [fixtureGift.gift_id] },
  'trade.created': { trade_id: 'trade-1', gift_ids: [fixtureGift.gift_id], amount: 2, asset: 'TON' },
  'trade.offer_created': {
    trade_id: 'trade-1',
    offer_id: 'trade-offer-1',
    gift_ids: [fixtureGift.gift_id],
    amount: 2,
    asset: 'TON',
  },
  'trade.completed': {
    trade_id: 'trade-1',
    offer_id: 'trade-offer-1',
    requested_gift_ids: [fixtureGift.gift_id],
    offered_gift_ids: [789],
    requested_amount: 2,
    requested_asset: 'TON',
    offered_amount: 0,
    offered_asset: 'TON',
  },
  'trade.cancelled': { trade_id: 'trade-1', gift_ids: [fixtureGift.gift_id] },
};

export function fixtureEvent(type: KnownEventType, suffix = 0): AnyMarketplaceEvent {
  const parsed = parseMarketplaceEvent({
    eventId: `fixture-${type}-${suffix}`,
    version: 1,
    type,
    occurredAt: new Date(Date.parse('2026-08-15T00:00:00.000Z') + suffix * 1_000).toISOString(),
    data: fixtureData[type],
  });
  return parsed;
}

export const allKnownFixtures = EVENT_TYPES.map((type, index) => fixtureEvent(type, index));

export function unknownFixture(): AnyMarketplaceEvent {
  return parseMarketplaceEvent({
    eventId: 'fixture-unknown-1',
    version: 1,
    type: 'future.event.added',
    occurredAt: '2026-08-15T00:00:00.000Z',
    data: { gift_id: fixtureGift.gift_id, vendor_note: 'untrusted text', new_field: { additive: true } },
  });
}

export function connectedFixture() {
  return parseMarketplaceMessage({
    type: 'marketplace.connected',
    version: 1,
    serverTime: '2026-08-15T00:00:00.000Z',
    replayEndpoint: '/api/marketplace/events',
  });
}
