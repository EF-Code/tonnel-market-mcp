import * as z from 'zod/v4';

import { EVENT_TYPES } from '../domain/events.js';

const isoUtc = z.string().refine((value) => Number.isFinite(Date.parse(value)) && value.endsWith('Z'), {
  message: 'Expected an ISO 8601 UTC timestamp ending in Z.',
});

const boundedLimit = z.number().int().min(1).max(500).default(50);
const eventTypes = z.array(z.string().min(1).max(100)).max(EVENT_TYPES.length).optional();
const traitString = z.string().min(1).max(256).optional();
const monetaryInput = z.union([z.number().finite().nonnegative(), z.string().min(1).max(64)]);

export const marketSearchSchema = z
  .object({
    giftId: z.number().int().positive().optional(),
    giftNum: z.number().int().positive().optional(),
    giftName: traitString,
    model: traitString,
    backdrop: traitString,
    symbol: traitString,
    eventTypes,
    asset: traitString,
    saleType: z.enum(['FIXED', 'DUTCH']).optional(),
    source: z.enum(['LISTING', 'DUTCH', 'BUY_OFFER', 'AUCTION']).optional(),
    minPrice: monetaryInput.optional(),
    maxPrice: monetaryInput.optional(),
    from: isoUtc.optional(),
    to: isoUtc.optional(),
    sort: z.enum(['occurred_desc', 'occurred_asc', 'price_asc', 'price_desc']).default('occurred_desc'),
    limit: boundedLimit,
    cursor: z.string().min(1).max(512).optional(),
  })
  .superRefine(validateWindow);

export const marketGiftHistorySchema = z
  .object({
    giftId: z.number().int().positive(),
    from: isoUtc.optional(),
    to: isoUtc.optional(),
    eventTypes,
    limit: boundedLimit,
    cursor: z.string().min(1).max(512).optional(),
  })
  .superRefine(validateWindow);

export const marketSalesSummarySchema = z
  .object({
    from: isoUtc,
    to: isoUtc,
    giftId: z.number().int().positive().optional(),
    model: traitString,
    backdrop: traitString,
    symbol: traitString,
    source: z.enum(['LISTING', 'DUTCH', 'BUY_OFFER', 'AUCTION']).optional(),
    asset: traitString,
    groupBy: z.enum(['gift', 'giftName', 'model', 'backdrop', 'symbol', 'source', 'asset', 'hour', 'day']).optional(),
  })
  .superRefine(validateWindow);

export const marketAuctionStatusSchema = z
  .object({
    auctionId: z.string().min(1).max(256).optional(),
    giftId: z.number().int().positive().optional(),
    status: z.enum(['OPEN', 'CANCELLED', 'SOLD', 'NO_BIDS', 'UNKNOWN']).optional(),
    endsFrom: isoUtc.optional(),
    endsTo: isoUtc.optional(),
    limit: boundedLimit,
  })
  .superRefine((value, context) => {
    if (!value.auctionId && value.giftId === undefined) {
      context.addIssue({ code: 'custom', path: ['auctionId'], message: 'auctionId or giftId is required.' });
    }
    validateWindow(value, context, 'endsFrom', 'endsTo');
  });

export const marketFindOpportunitiesSchema = z
  .object({
    strategy: z.enum(['below_recent_median', 'price_drop', 'auction_ending', 'offer_activity', 'premarket_spread']),
    lookbackFrom: isoUtc,
    lookbackTo: isoUtc,
    giftId: z.number().int().positive().optional(),
    model: traitString,
    backdrop: traitString,
    symbol: traitString,
    asset: traitString,
    thresholdPercent: z.number().finite().min(0).max(100).optional(),
    endingWithinMinutes: z.number().int().min(0).max(10_080).optional(),
    minimumBidCount: z.number().int().min(0).max(500).optional(),
    minimumOfferCount: z.number().int().min(1).max(500).optional(),
    minimumComparableSample: z.number().int().min(1).max(500).optional(),
    limit: boundedLimit,
  })
  .superRefine((value, context) => validateWindow(value, context, 'lookbackFrom', 'lookbackTo'));

export const marketHealthSchema = z.object({});

export const marketCreateAlertSchema = z.object({
  name: z.string().min(1).max(100),
  enabled: z.boolean().optional(),
  eventTypes,
  giftId: z.number().int().positive().optional(),
  giftName: traitString,
  model: traitString,
  backdrop: traitString,
  symbol: traitString,
  asset: traitString,
  saleType: z.enum(['FIXED', 'DUTCH']).optional(),
  source: z.enum(['LISTING', 'DUTCH', 'BUY_OFFER', 'AUCTION']).optional(),
  minPrice: monetaryInput.optional(),
  maxPrice: monetaryInput.optional(),
  auctionEndsWithinMinutes: z.number().int().min(0).max(10_080).optional(),
  strategy: z.enum(['below_recent_median', 'price_drop', 'auction_ending', 'offer_activity', 'premarket_spread']).optional(),
});

export const marketListAlertsSchema = z.object({
  includeHits: z.boolean().default(false),
  limit: boundedLimit,
});

export const marketDeleteAlertSchema = z.object({
  alertId: z.number().int().positive(),
});

export const marketTestAlertSchema = z.object({
  alertId: z.number().int().positive(),
  sampleEvent: z.record(z.string(), z.unknown()),
});

export type MarketSearchInput = z.infer<typeof marketSearchSchema>;
export type MarketGiftHistoryInput = z.infer<typeof marketGiftHistorySchema>;
export type MarketSalesSummaryInput = z.infer<typeof marketSalesSummarySchema>;
export type MarketAuctionStatusInput = z.infer<typeof marketAuctionStatusSchema>;
export type MarketFindOpportunitiesInput = z.infer<typeof marketFindOpportunitiesSchema>;
export type MarketCreateAlertInput = z.infer<typeof marketCreateAlertSchema>;

function validateWindow(
  value: { from?: string; to?: string },
  context: z.RefinementCtx,
  fromKey = 'from',
  toKey = 'to',
): void {
  const from = value[fromKey as keyof typeof value];
  const to = value[toKey as keyof typeof value];
  if (typeof from === 'string' && typeof to === 'string' && from > to) {
    context.addIssue({ code: 'custom', path: [fromKey], message: `${fromKey} must be before ${toKey}.` });
  }
}
