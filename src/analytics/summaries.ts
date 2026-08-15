import {
  compareDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
  ratioDecimal,
  subtractDecimal,
  type DecimalString,
} from "../domain/money.js";
import { CoverageService } from "./coverage.js";
import { maximum, median, minimum, percentile, sum } from "./statistics.js";
import type {
  HistoryOptions,
  QueryRepository,
  SaleRow,
  SearchObservation,
  SearchOptions,
} from "../storage/query-repository.js";

export type SalesSummaryInput = {
  from: string;
  to: string;
  giftId?: number;
  model?: string;
  backdrop?: string;
  symbol?: string;
  source?: string;
  asset?: string;
  groupBy?:
    | "gift"
    | "giftName"
    | "model"
    | "backdrop"
    | "symbol"
    | "source"
    | "asset"
    | "hour"
    | "day";
};

export type OpportunityInput = {
  strategy:
    | "below_recent_median"
    | "price_drop"
    | "auction_ending"
    | "offer_activity"
    | "premarket_spread";
  lookbackFrom: string;
  lookbackTo: string;
  asset?: string;
  giftId?: number;
  model?: string;
  backdrop?: string;
  symbol?: string;
  thresholdPercent?: number;
  endingWithinMinutes?: number;
  minimumBidCount?: number;
  minimumOfferCount?: number;
  minimumComparableSample?: number;
  limit: number;
};

export class MarketAnalytics {
  constructor(
    private readonly query: QueryRepository,
    private readonly coverage: CoverageService,
  ) {}

  search(input: SearchOptions) {
    const result = this.query.search(input);
    const coverage = this.coverage.get(input);
    return {
      data: { observations: result.results },
      coverage,
      canonicalEventTypes: result.results.map((item) => item.type),
      eventIds: result.results.map((item) => item.eventId),
      warnings: [
        ...this.coverage.warnings(coverage),
        "Listing observations do not have a stable upstream listing_id and cannot always reconstruct a lifecycle.",
      ],
      nextCursor: result.nextCursor,
    };
  }

  history(input: HistoryOptions) {
    const result = this.query.history(input);
    const coverage = this.coverage.get(input);
    return {
      data: { giftId: input.giftId, timeline: result.results },
      coverage,
      canonicalEventTypes: result.results.map((item) => item.type),
      eventIds: result.results.map((item) => item.eventId),
      warnings: [
        ...this.coverage.warnings(coverage),
        "The API intentionally provides no owner, buyer, seller, bidder, maker, taker, or wallet identity.",
      ],
      nextCursor: result.nextCursor,
    };
  }

  salesSummary(input: SalesSummaryInput) {
    const sales = this.query.sales(input);
    const coverage = this.coverage.get(input);
    const groups = groupSales(sales, input.groupBy);
    return {
      data: {
        from: input.from,
        to: input.to,
        observedSaleCount: sales.length,
        groups,
      },
      coverage,
      canonicalEventTypes: ["sale.completed"],
      eventIds: sales.map((sale) => sale.eventId),
      warnings: [
        ...this.coverage.warnings(coverage),
        "Sales count and volume use sale.completed only; auction.finished is not counted as a second sale.",
        ...(input.asset
          ? []
          : [
              "Assets are split into separate groups; unlike assets are never summed.",
            ]),
      ],
    };
  }

  auctionStatus(input: {
    auctionId?: string;
    giftId?: number;
    status?: string;
    endsFrom?: string;
    endsTo?: string;
    limit: number;
  }) {
    const auctions = this.query.listAuctions(input);
    const coverage = this.coverage.get({
      ...(input.endsFrom ? { from: input.endsFrom } : {}),
      ...(input.endsTo ? { to: input.endsTo } : {}),
    });
    return {
      data: {
        auctions: auctions.map((auction) => ({
          ...auction,
          bids: this.query.auctionBids(auction.auctionId),
        })),
      },
      coverage,
      canonicalEventTypes: [
        "auction.created",
        "auction.bid_placed",
        "auction.extended",
        "auction.cancelled",
        "auction.finished",
      ],
      eventIds: auctions.flatMap((auction) => [
        auction.createdEventId,
        auction.lastEventId,
      ]),
      warnings: [
        ...this.coverage.warnings(coverage),
        "Bid count is a count of observed bid events, not unique bidders.",
        "Winning bids are auction lifecycle facts; sales totals still come only from sale.completed.",
        "Dutch price decay is not estimated because the upstream contract does not define its exact formula.",
      ],
    };
  }

  findOpportunities(input: OpportunityInput) {
    const coverage = this.coverage.get({
      from: input.lookbackFrom,
      to: input.lookbackTo,
    });
    const warnings = [
      ...this.coverage.warnings(coverage),
      "This is an evidence-bounded screen, not financial advice, an execution signal, or a guarantee of profit.",
      "The feed contains no identity or ownership information and must not authorize a transaction.",
    ];
    const common: Partial<SearchOptions> = {
      from: input.lookbackFrom,
      to: input.lookbackTo,
      limit: input.limit,
    };
    if (input.giftId !== undefined) common.giftId = input.giftId;
    if (input.model) common.model = input.model;
    if (input.backdrop) common.backdrop = input.backdrop;
    if (input.symbol) common.symbol = input.symbol;
    if (input.asset) common.asset = input.asset;
    const opportunities = (() => {
      switch (input.strategy) {
        case "below_recent_median":
          return this.belowMedian(input, common);
        case "price_drop":
          return this.priceDrops(input, common);
        case "auction_ending":
          return this.auctionsEnding(input);
        case "offer_activity":
          return this.offerActivity(input, common);
        case "premarket_spread":
          return this.premarketSpreads(input, common);
      }
    })();
    return {
      data: { strategy: input.strategy, opportunities },
      coverage,
      canonicalEventTypes: opportunities.flatMap(
        (item) => item.canonicalEventTypes,
      ),
      eventIds: opportunities.flatMap((item) => item.eventIds),
      warnings,
    };
  }

  stats24h(now = new Date()): {
    data: Record<string, unknown>;
    coverage: ReturnType<CoverageService["get"]>;
    canonicalEventTypes: string[];
    eventIds: string[];
    warnings: string[];
  } {
    const to = now.toISOString();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
    const stats = this.query.statsSince(from);
    const coverage = this.coverage.get({ from, to });
    return {
      data: { from, to, ...stats },
      coverage,
      canonicalEventTypes: [
        "sale.completed",
        "listing.created",
        "auction.created",
        "buy_offer.created",
      ],
      eventIds: [],
      warnings: this.coverage.warnings(coverage),
    };
  }

  private belowMedian(
    input: OpportunityInput,
    common: Partial<SearchOptions>,
  ): Opportunity[] {
    const saleOptions = {
      from: input.lookbackFrom,
      to: input.lookbackTo,
    } as Parameters<QueryRepository["sales"]>[0];
    if (input.giftId !== undefined) saleOptions.giftId = input.giftId;
    if (input.model) saleOptions.model = input.model;
    if (input.backdrop) saleOptions.backdrop = input.backdrop;
    if (input.symbol) saleOptions.symbol = input.symbol;
    if (input.asset) saleOptions.asset = input.asset;
    const sales = this.query.sales(saleOptions);
    const minimumSample = input.minimumComparableSample ?? 10;
    if (sales.length < minimumSample) return [];
    const reference = median(sales.map((sale) => sale.price));
    if (!reference) return [];
    const thresholdPercent = input.thresholdPercent ?? 20;
    const listings = this.query.search({
      ...common,
      eventTypes: ["listing.created"],
      minPrice: 0,
      sort: "price_asc",
      limit: input.limit,
    } as SearchOptions).results;
    const threshold = decimal(input.thresholdPercent ?? 20);
    const boundary = divideDecimal(
      multiplyDecimal(reference, subtractDecimal(100, threshold)),
      100,
    );
    return listings
      .filter(
        (listing) =>
          listing.price && compareDecimal(listing.price, boundary) <= 0,
      )
      .map((listing) => ({
        observedFact: listing,
        reference: {
          metric: "recent_median",
          value: reference,
          sampleSize: sales.length,
          asset: input.asset ?? sales[0]?.asset,
        },
        formula: `observed price <= recent median * (1 - ${thresholdPercent}%)`,
        difference: listing.price
          ? subtractDecimal(listing.price, reference)
          : null,
        confidence: confidenceForSample(sales.length),
        eventIds: listing.eventId
          ? [
              listing.eventId,
              ...sales
                .slice(0, Math.min(3, sales.length))
                .map((sale) => sale.eventId),
            ]
          : [],
        canonicalEventTypes: ["listing.created", "sale.completed"],
      }));
  }

  private priceDrops(
    input: OpportunityInput,
    common: Partial<SearchOptions>,
  ): Opportunity[] {
    const threshold = input.thresholdPercent ?? 20;
    const rows = this.query.search({
      ...common,
      eventTypes: ["listing.price_changed"],
      sort: "occurred_desc",
      limit: input.limit,
    } as SearchOptions).results;
    return rows.flatMap((row) => {
      const previous = valueAsDecimal(row.data.previous_price);
      const current = valueAsDecimal(row.data.price);
      if (!previous || !current || compareDecimal(previous, 0) === 0) return [];
      const drop = ratioDecimal(
        multiplyDecimal(subtractDecimal(previous, current), 100),
        previous,
      );
      if (compareDecimal(drop, threshold) < 0) return [];
      return [
        {
          observedFact: row,
          reference: { previousPrice: previous, currentPrice: current },
          formula: `(previous_price - price) / previous_price * 100 >= ${threshold}%`,
          difference: drop,
          confidence: "medium" as const,
          eventIds: [row.eventId],
          canonicalEventTypes: ["listing.price_changed"],
        },
      ];
    });
  }

  private auctionsEnding(input: OpportunityInput): Opportunity[] {
    const now = new Date(input.lookbackTo);
    const minutes = input.endingWithinMinutes ?? 60;
    const endsTo = new Date(now.getTime() + minutes * 60_000).toISOString();
    const auctionOptions: Parameters<QueryRepository["listAuctions"]>[0] = {
      endsFrom: input.lookbackFrom,
      endsTo,
      limit: input.limit,
    };
    if (input.giftId !== undefined) auctionOptions.giftId = input.giftId;
    const auctions = this.query.listAuctions(auctionOptions);
    const minimumBids = input.minimumBidCount ?? 3;
    return auctions
      .filter((auction) => auction.bidCount >= minimumBids)
      .map((auction) => ({
        observedFact: auction,
        reference: {
          observedBidCount: auction.bidCount,
          minimumBidCount: minimumBids,
          endsWithinMinutes: minutes,
        },
        formula: `observed bid count >= ${minimumBids} and ends_at <= lookbackTo + ${minutes} minutes`,
        difference: decimal(auction.bidCount - minimumBids),
        confidence: confidenceForSample(auction.bidCount),
        eventIds: [auction.createdEventId, auction.lastEventId],
        canonicalEventTypes: [
          "auction.created",
          "auction.bid_placed",
          "auction.finished",
        ],
      }));
  }

  private offerActivity(
    input: OpportunityInput,
    common: Partial<SearchOptions>,
  ): Opportunity[] {
    const minimumOffers = input.minimumOfferCount ?? 3;
    const rows = this.query.search({
      ...common,
      eventTypes: ["buy_offer.created", "buy_offer.countered"],
      sort: "occurred_desc",
      limit: Math.min(500, input.limit * 20),
    } as SearchOptions).results;
    const byGift = new Map<number, SearchObservation[]>();
    for (const row of rows) {
      const giftId = row.gift?.gift_id ?? valueAsNumber(row.data.gift_id);
      if (giftId === undefined) continue;
      const list = byGift.get(giftId) ?? [];
      list.push(row);
      byGift.set(giftId, list);
    }
    return [...byGift.entries()]
      .filter(([, events]) => events.length >= minimumOffers)
      .slice(0, input.limit)
      .map(([giftId, events]) => ({
        observedFact: { giftId, observedOfferEvents: events },
        reference: {
          minimumOfferCount: minimumOffers,
          sampleSize: events.length,
        },
        formula: `observed direct buy-offer event count >= ${minimumOffers}`,
        difference: decimal(events.length - minimumOffers),
        confidence: confidenceForSample(events.length),
        eventIds: events.map((event) => event.eventId),
        canonicalEventTypes: ["buy_offer.created", "buy_offer.countered"],
      }));
  }

  private premarketSpreads(
    input: OpportunityInput,
    common: Partial<SearchOptions>,
  ): Opportunity[] {
    const rows = this.query.search({
      ...common,
      eventTypes: ["premarket.listing_created", "premarket.sale_completed"],
      sort: "occurred_desc",
      limit: Math.min(500, input.limit * 20),
    } as SearchOptions).results;
    const grouped = new Map<string, SearchObservation[]>();
    for (const row of rows) {
      if (!row.gift?.gift_id || !row.asset) continue;
      const key = `${row.gift.gift_id}:${row.asset}`;
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    return [...grouped.entries()]
      .flatMap(([, events]) => {
        const listing = events.find(
          (event) => event.type === "premarket.listing_created",
        );
        const sale = events.find(
          (event) => event.type === "premarket.sale_completed",
        );
        if (!listing?.price || !sale?.price) return [];
        return [
          {
            observedFact: { listing, sale },
            reference: {
              listingPrice: listing.price,
              salePrice: sale.price,
              asset: listing.asset,
            },
            formula:
              "premarket sale price minus observed premarket listing price for the same gift and asset",
            difference: subtractDecimal(sale.price, listing.price),
            confidence: "low" as const,
            eventIds: [listing.eventId, sale.eventId],
            canonicalEventTypes: [
              "premarket.listing_created",
              "premarket.sale_completed",
            ],
          },
        ];
      })
      .slice(0, input.limit);
  }
}

export type Opportunity = {
  observedFact: unknown;
  reference: Record<string, unknown>;
  formula: string;
  difference: DecimalString | null;
  confidence: "low" | "medium" | "high";
  eventIds: string[];
  canonicalEventTypes: string[];
};

function groupSales(sales: SaleRow[], groupBy: SalesSummaryInput["groupBy"]) {
  const groups = new Map<string, SaleRow[]>();
  for (const sale of sales) {
    const key = groupKey(sale, groupBy);
    groups.set(key, [...(groups.get(key) ?? []), sale]);
  }
  return [...groups.entries()].map(([key, values]) => ({
    key,
    asset: values[0]?.asset,
    saleCount: values.length,
    volume: sum(values.map((sale) => sale.price)),
    minimum: minimum(values.map((sale) => sale.price)),
    maximum: maximum(values.map((sale) => sale.price)),
    median: median(values.map((sale) => sale.price)),
    percentiles: {
      p25: percentile(
        values.map((sale) => sale.price),
        25,
      ),
      p75: percentile(
        values.map((sale) => sale.price),
        75,
      ),
    },
    eventIds: values.map((sale) => sale.eventId),
  }));
}

function groupKey(
  sale: SaleRow,
  groupBy: SalesSummaryInput["groupBy"],
): string {
  if (!groupBy || groupBy === "asset") return sale.asset;
  if (groupBy === "gift") return String(sale.gift.gift_id);
  if (groupBy === "giftName") return sale.gift.gift_name;
  if (groupBy === "model") return sale.gift.model;
  if (groupBy === "backdrop") return sale.gift.backdrop;
  if (groupBy === "symbol") return sale.gift.symbol;
  if (groupBy === "source") return `${sale.asset}:${sale.source}`;
  const date = new Date(sale.occurredAt);
  return groupBy === "hour"
    ? date.toISOString().slice(0, 13)
    : date.toISOString().slice(0, 10);
}

function confidenceForSample(sampleSize: number): "low" | "medium" | "high" {
  return sampleSize >= 30 ? "high" : sampleSize >= 10 ? "medium" : "low";
}

function valueAsDecimal(value: unknown): DecimalString | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  try {
    return decimal(value);
  } catch {
    return undefined;
  }
}

function valueAsNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}
