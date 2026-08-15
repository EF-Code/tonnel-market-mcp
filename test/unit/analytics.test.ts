import assert from "node:assert/strict";
import test from "node:test";

import { CoverageService } from "../../src/analytics/coverage.js";
import { MarketAnalytics } from "../../src/analytics/summaries.js";
import { parseMarketplaceEvent } from "../../src/domain/schemas.js";
import { CoverageRepository } from "../../src/storage/coverage-repository.js";
import { DatabaseManager } from "../../src/storage/database.js";
import { EventRepository } from "../../src/storage/event-repository.js";
import { ProjectionRepository } from "../../src/storage/projection-repository.js";
import { QueryRepository } from "../../src/storage/query-repository.js";
import { fixtureEvent } from "../fixtures/events.js";

function setup() {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const events = new EventRepository(database);
  const projections = new ProjectionRepository();
  const coverageRepository = new CoverageRepository(database.db);
  const coverage = new CoverageService(coverageRepository, events, database);
  events.initializeCollector("2026-08-15T00:00:00.000Z");
  return {
    database,
    events,
    projections,
    coverageRepository,
    analytics: new MarketAnalytics(new QueryRepository(database.db), coverage),
  };
}

function process(
  events: EventRepository,
  projections: ProjectionRepository,
  event: ReturnType<typeof fixtureEvent>,
  sequence: number,
): void {
  events.processEvent(
    event,
    {
      source: "replay",
      receivedAt: "2026-08-15T02:00:00.000Z",
      receiveSequence: sequence,
      correlationId: `analytics-${sequence}`,
    },
    (db) => projections.apply(db, event),
  );
}

test("sales summaries keep assets separate and count only canonical sales", () => {
  const { database, events, projections, coverageRepository, analytics } =
    setup();
  const tonSale = fixtureEvent("sale.completed", 1);
  const usdtSale = parseMarketplaceEvent({
    ...fixtureEvent("sale.completed", 2),
    eventId: "analytics-usdt-sale",
    data: {
      ...fixtureEvent("sale.completed", 2).data,
      price: 4,
      asset: "USDT",
    },
  });
  const auctionFinished = fixtureEvent("auction.finished", 3);
  process(events, projections, tonSale, 1);
  process(events, projections, usdtSale, 2);
  process(events, projections, auctionFinished, 3);
  coverageRepository.record(
    "available",
    { from: "2026-08-15T00:00:00.000Z", to: "2026-08-15T05:00:00.000Z" },
    "deterministic test coverage",
    "test",
    "2026-08-15T05:00:00.000Z",
  );

  const result = analytics.salesSummary({
    from: "2026-08-15T00:00:00.000Z",
    to: "2026-08-15T05:00:00.000Z",
  });
  assert.equal(result.data.observedSaleCount, 2);
  assert.deepEqual(
    result.data.groups.map((group) => [group.asset, group.volume]).sort(),
    [
      ["TON", "11"],
      ["USDT", "4"],
    ],
  );
  assert.equal(result.coverage.complete, false);
  assert.equal(
    result.warnings.some((warning) => /auction.finished/u.test(warning)),
    true,
  );
  database.close();
});

test("below-recent-median screening reports formula, sample, and provenance", () => {
  const { database, events, projections, analytics } = setup();
  for (const [index, price] of [10, 12].entries()) {
    const event = parseMarketplaceEvent({
      ...fixtureEvent("sale.completed", index),
      eventId: `analytics-sale-${index}`,
      data: { ...fixtureEvent("sale.completed", index).data, price },
    });
    process(events, projections, event, index + 1);
  }
  const listing = parseMarketplaceEvent({
    ...fixtureEvent("listing.created", 4),
    eventId: "analytics-below-median-listing",
    data: { ...fixtureEvent("listing.created", 4).data, price: 5 },
  });
  process(events, projections, listing, 3);

  const result = analytics.findOpportunities({
    strategy: "below_recent_median",
    lookbackFrom: "2026-08-15T00:00:00.000Z",
    lookbackTo: "2026-08-15T05:00:00.000Z",
    minimumComparableSample: 2,
    thresholdPercent: 20,
    limit: 10,
  });
  assert.equal(result.data.opportunities.length, 1);
  assert.match(result.data.opportunities[0]?.formula ?? "", /recent median/u);
  assert.deepEqual(result.data.opportunities[0]?.eventIds, [
    "analytics-below-median-listing",
    "analytics-sale-0",
    "analytics-sale-1",
  ]);
  database.close();
});
