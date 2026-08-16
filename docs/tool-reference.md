# MCP tool and resource reference

All tool calls are schema-validated and bounded. Market query results use:

```json
{
  "data": {},
  "coverage": {},
  "provenance": {
    "source": "Tonnel Marketplace Event API",
    "canonicalEventTypes": [],
    "generatedAt": "2026-08-15T00:00:00.000Z"
  },
  "warnings": [],
  "pagination": { "nextCursor": null }
}
```

## Market tools

### `market_search`

Optional filters: `giftId`, `giftNum`, `giftName`, `model`, `backdrop`, `symbol`, `eventTypes`, `asset`, `saleType`, `source`, `minPrice`, `maxPrice`, `from`, `to`, `sort`, `limit`, and `cursor`. `sort` is one of `occurred_desc`, `occurred_asc`, `price_asc`, or `price_desc`; `limit` is `1..500` and defaults to `50`.

If `from` or `to` is supplied, inspect `coverage.requestedWindowCovered`. A false value means the local collector has not reached the requested window yet; an empty result is provisional.

### `market_recent_listings`

Returns general recent `listing.created` and `listing.price_changed` observations. `minutes` defaults to `5` and is bounded to `1..1440`; `to` defaults to the current UTC time. Optional filters include `giftId`, `giftNum`, `giftName`, `model`, `backdrop`, `symbol`, `asset`, `saleType`, `source`, `eventTypes`, and `limit`.

The tool waits up to `waitSeconds` (default `30`, bounded to `0..300`) for replay to catch up and the WebSocket to become current. `data.ready` is the convenience flag for this call. If it is false, treat zero observations as “not established,” not as proof that no listing occurred.

### `market_gift_history`

Required: positive `giftId`. Optional: `from`, `to`, allowlisted `eventTypes`, bounded `limit`, and opaque `cursor`. Results are chronological observations and never identity records.

### `market_sales_summary`

Required: UTC `from` and `to`. Optional: gift/trait filters, `source`, `asset`, and a strict `groupBy` of `gift`, `giftName`, `model`, `backdrop`, `symbol`, `source`, `asset`, `hour`, or `day`. Sales are canonicalized to `sale.completed`.

### `market_auction_status`

Requires `auctionId` or `giftId`. Optional: `status`, `endsFrom`, `endsTo`, and `limit`. It returns lifecycle data plus observed bid rows. An observed bid is not a unique bidder.

### `market_find_opportunities`

Required: `strategy`, `lookbackFrom`, `lookbackTo`; supported strategies are `below_recent_median`, `price_drop`, `auction_ending`, `offer_activity`, and `premarket_spread`. Optional thresholds include `thresholdPercent`, `endingWithinMinutes`, `minimumBidCount`, `minimumOfferCount`, `minimumComparableSample`, trait filters, `asset`, and `limit`. Results include an observed fact, reference sample, formula, difference, confidence label, event IDs, coverage, and non-advisory warnings.

### `market_health`

Takes an empty object and returns collector, WebSocket, replay, checkpoint, lag, duplicate, unknown-event, processing-error, coverage-gap, and migration state. `coverage.stream.current` is true only after replay has completed and the live WebSocket is connected. It omits credentials, local paths, and stack traces.

## Local alert tools

- `market_create_alert`: accepts a name plus event, gift/trait, asset, sale/source, price, auction-window, or strategy predicates. The change is local configuration only.
- `market_list_alerts`: accepts `includeHits` and bounded `limit`.
- `market_delete_alert`: requires a positive `alertId` and deletes only local rule/hit state.
- `market_test_alert`: requires an `alertId` and one supplied event envelope; it does not persist a hit or notify an external service.

The built-in notifier logs a safe local match. No external notification credential or webhook is part of the project.

## Resources and templates

| URI                                | Meaning                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `market://coverage`                | Collector start, available interval, gaps, checkpoint, and snapshot limitation. |
| `market://schema/events`           | Known event catalog and privacy/read-only contract.                             |
| `market://stats/24h`               | Bounded local 24-hour event statistics.                                         |
| `market://gift/{gift_id}/timeline` | Observed timeline for a public gift ID.                                         |
| `market://auction/{auction_id}`    | Observed auction lifecycle and bids.                                            |
| `market://reports/daily/{date}`    | One UTC date's canonical sales summary and coverage.                            |

## Prompts

`daily_market_brief`, `compare_gifts`, and `auction_watch_report` provide reusable instructions that require asset separation, sample sizes, event provenance, coverage statements, and no identity or transaction inference.
