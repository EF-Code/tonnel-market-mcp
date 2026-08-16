# Data contract and analytical definitions

The authoritative upstream envelope is:

```ts
type MarketplaceEvent = {
  eventId: string;
  version: 1;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
};
```

Known types are validated with discriminated Zod schemas. Unknown event types and additive fields are retained in `raw_events` so a newer upstream event does not silently destroy the local ledger. `marketplace.connected` is a connection diagnostic, not an event and never advances a checkpoint.

## Projections

| Projection                 | Source events                    | Boundary                                                 |
| -------------------------- | -------------------------------- | -------------------------------------------------------- |
| `gifts`                    | gift-bearing events              | Public gift metadata only.                               |
| `listing_observations`     | listing lifecycle events         | Immutable observations; no invented listing ID.          |
| `sale_facts`               | `sale.completed`                 | The only canonical sale count and volume source.         |
| `auctions`, `auction_bids` | auction lifecycle and bid events | Bid count means observed bid events, not unique bidders. |
| `buy_offers`               | direct buy-offer events          | Individual gift offers, not collection-wide orders.      |
| `premarket_facts`          | premarket events                 | Event-specific values and status.                        |
| `bundles`, `trades`        | bundle and trade events          | Public gift IDs and amounts only.                        |

Every projection keeps the originating event ID. The complete normalized envelope remains in `raw_events.raw_payload`.

## Money and assets

Prices are normalized to canonical decimal strings backed by `BigInt`. Raw JSON is preserved separately. Arithmetic aligns decimal scales and does not use binary floating point for sums, medians, ratios, or thresholds. `TON`, `TONNEL`, `USDT`, and other asset strings are separate dimensions. No conversion rate or timestamp is supplied by this feed, so unlike assets are never summed or compared.

## Coverage

The replay service retains seven days and does not expose a full active-market snapshot. Coverage is therefore explicit:

- `partial`: no replay availability interval has been established.
- `seven_day_replay_baseline`: replay events are available, but completeness is not proven.
- `full_snapshot`: reserved for a future trustworthy full-snapshot source; this implementation never claims it from replay alone.

Gaps are recorded for expired cursors and other known discontinuities. A result is `complete` only when a full snapshot exists, the requested interval is covered, and no overlapping gaps exist.

For time-bounded queries, `requestedWindowCovered` is the separate readiness signal. It can be true for a connected replay-complete stream even though `complete` remains false because the upstream does not provide a full active-market snapshot. `stream.current` is true only when replay has completed and the WebSocket is connected; an empty result with `requestedWindowCovered: false` is provisional.

## Definitions

- **Sales count:** number of `sale.completed` events.
- **Volume:** sum of canonical sale prices within one asset.
- **Observed floor:** a local minimum among observed listing data; it is not a complete marketplace floor.
- **Price drop:** `(previous_price - price) / previous_price * 100` for one `listing.price_changed` event, with a non-zero denominator and exact decimal arithmetic.
- **Recent median:** median of canonical comparable sale prices in a declared window and asset.
- **Premarket spread:** sale price minus listing price for the same public gift and asset; it is a low-confidence observed difference, not a forecast.
- **Time to sale:** unavailable as an exact fact because there is no stable listing ID.
- **Rarity:** unavailable as an authoritative score. Trait strings are metadata; any local frequency is only an observed-frequency metric.

Analytical results carry formulas, sample sizes, event IDs, coverage, and warnings. They do not label observations as guaranteed profit, safe purchases, or ownership evidence.
