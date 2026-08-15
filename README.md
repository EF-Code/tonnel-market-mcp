# tonnel-market-mcp

`tonnel-market-mcp` is an unofficial, third-party Model Context Protocol (MCP) server for the public Tonnel Marketplace Event API. It runs one durable local collector, stores raw events and normalized projections in SQLite, and exposes bounded read-only market observations to MCP clients.

It does not represent or speak for Tonnel, Telegram, TON, or any marketplace. It does not connect wallets, sign messages, list, buy, bid, sell, transfer, settle, or authorize transactions. The upstream feed contains public gift and marketplace events, not Telegram or wallet identity. This project never infers sellers, buyers, bidders, makers, takers, or owners.

## Requirements and installation

- Node.js 22 or newer.
- A working native build toolchain for `better-sqlite3` when a prebuilt binary is unavailable.
- Network access to the public upstream API only when the collector is running.

```sh
git clone https://github.com/EF-Code/tonnel-market-mcp.git
cd tonnel-market-mcp
npm ci
npm run build
npm run migrate
```

The default database is `.data/tonnel-market.sqlite`. WAL sidecars are kept beside it. The database is created and migrated by the process; do not copy an actively written database without coordinating a SQLite backup.

## Run locally

Start the default stdio server:

```sh
npm run start:stdio
```

The stdio process writes MCP JSON-RPC only to stdout. Diagnostics go to stderr. A generic MCP host configuration is:

```json
{
  "mcpServers": {
    "tonnel-market": {
      "command": "node",
      "args": ["<PROJECT_DIR>/dist/src/cli.js", "--transport", "stdio"],
      "env": {
        "TONNEL_MARKET_DB_PATH": "<PROJECT_DIR>/.data/tonnel-market.sqlite"
      }
    }
  }
}
```

For a local Codex registration, use the equivalent command supported by your installed Codex version, with `<PROJECT_DIR>` replaced by the checkout path:

```sh
codex mcp add tonnel-market -- node "<PROJECT_DIR>/dist/src/cli.js" --transport stdio
```

Run `npm run build` after source changes. `npm run dev` rebuilds and watches the stdio entrypoint.

## Optional Streamable HTTP

HTTP binds to `127.0.0.1:8787` by default:

```sh
npm run start:http
```

Binding outside loopback is an explicit opt-in and requires `TONNEL_MARKET_HTTP_TOKEN`. Use HTTPS at a correctly configured reverse proxy, restrict origins and hosts, apply rate limiting, and treat the bearer token as a protected secret. This implementation is a local/controlled deployment boundary; it is not an OAuth authorization server and should not be placed directly on the public internet as a substitute for MCP authorization.

```sh
TONNEL_MARKET_HTTP_HOST=127.0.0.1 \
TONNEL_MARKET_HTTP_TOKEN='<local-secret>' \
npm run start:http
```

The MCP endpoint is `/mcp`. HTTP requests are bounded to 1 MiB and receive secure response headers. See [docs/security.md](docs/security.md) before using HTTP beyond a local machine.

## Configuration

| Variable                      | Default                                      | Purpose                                                             |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| `TONNEL_MARKET_API_BASE`      | `https://gifts.coffin.meme`                  | Replay API base URL.                                                |
| `TONNEL_MARKET_WS_URL`        | `wss://gifts.coffin.meme/api/marketplace/ws` | Live WebSocket URL.                                                 |
| `TONNEL_MARKET_DB_PATH`       | `.data/tonnel-market.sqlite`                 | SQLite path.                                                        |
| `TONNEL_MARKET_LOG_LEVEL`     | `info`                                       | `error`, `warn`, `info`, or `debug`.                                |
| `TONNEL_MARKET_MCP_TRANSPORT` | `stdio`                                      | `stdio` or `http`.                                                  |
| `TONNEL_MARKET_HTTP_HOST`     | `127.0.0.1`                                  | HTTP bind host.                                                     |
| `TONNEL_MARKET_HTTP_PORT`     | `8787`                                       | HTTP bind port.                                                     |
| `TONNEL_MARKET_HTTP_PUBLIC`   | `false`                                      | Explicit public-mode marker; non-loopback hosts imply it.           |
| `TONNEL_MARKET_HTTP_TOKEN`    | unset                                        | Required when HTTP is public or a protected listener is configured. |

See [.env.example](.env.example) and [examples/config.example.env](examples/config.example.env). Values are placeholders only; credentials must stay outside the repository.

## MCP surface

Market query tools return `data`, a coverage envelope, provenance, warnings, and an optional opaque pagination cursor:

- `market_search` — bounded raw/projected observation search.
- `market_gift_history` — chronological events involving one public gift ID.
- `market_sales_summary` — `sale.completed` statistics, split by asset.
- `market_auction_status` — auction lifecycle, observed bids, and extensions.
- `market_find_opportunities` — deterministic evidence-bounded screens, never a recommendation or execution signal.
- `market_health` — collector, replay, checkpoint, coverage, and migration state.
- `market_create_alert`, `market_list_alerts`, `market_delete_alert`, `market_test_alert` — local alert configuration and durable local hits only.

Resources and templates:

- `market://coverage`
- `market://schema/events`
- `market://stats/24h`
- `market://gift/{gift_id}/timeline`
- `market://auction/{auction_id}`
- `market://reports/daily/{date}`

Reusable prompts:

- `daily_market_brief`
- `compare_gifts`
- `auction_watch_report`

The prompt and tool wording tells consuming models to separate direct event facts, deterministic metrics, estimates, and unavailable information. Full schemas and examples are in [docs/tool-reference.md](docs/tool-reference.md).

## Coverage and analytical limits

The replay API retains approximately seven days and does not provide a complete active-market snapshot. A newly started collector therefore cannot prove a complete inventory or marketplace floor. Every market result reports one of `partial`, `seven_day_replay_baseline`, or `full_snapshot`, plus explicit gaps and warnings. This implementation does not mark a full snapshot because the supplied upstream contract does not provide one.

Sales are counted only from `sale.completed`; `auction.finished` is not counted as a second sale. Volumes and statistics never combine unlike assets. The upstream API has no stable `listing_id`, so listing timelines are observed event sequences rather than guaranteed listing lifecycles. Bid counts are observed bid-event counts, not unique bidder counts. Dutch decay is not estimated because the upstream contract does not define its formula.

Useful questions include:

- What happened in the Tonnel gift market during the last 24 hours?
- Show observed Durov's Cap listings below 100 TON.
- Give me the event history for gift 123456.
- Compare fixed-price and auction sales for this model.
- Which auctions end in the next hour and have at least three observed bids?
- Find observed listings at least 20% below the recent median with a sample of 10 or more sales.
- Why might this result be incomplete?
- Is the collector healthy and fully caught up?
- Create a local alert for Freshwave listings below 20 TON.

## Verification

```sh
npm run verify
npm run release:preflight
npm run package:smoke
npm run test:live
```

`npm run verify` is deterministic and does not contact Tonnel. `npm run package:smoke` installs the generated tarball in a fresh temporary prefix, rebuilds the native SQLite dependency, and runs the migration entrypoint. `npm run test:live` is optional, read-only, and tolerated when the upstream is unavailable; it is not part of CI. The protocol suite uses the official MCP TypeScript client over an in-memory transport and the real stdio child process. It verifies tool/resource/prompt discovery, a tool call, a resource read, prompt retrieval, and stdout protocol integrity.

## Troubleshooting

- **Expired cursor:** the collector records a visible coverage gap and restarts replay without `after`; inspect `market_health` and `market://coverage`.
- **Stale or incomplete results:** check replay state, `lastCommittedEventId`, coverage mode, gaps, and the collector start time. A seven-day baseline is not a full snapshot.
- **Database lock:** stop duplicate collectors using the same path, keep WAL sidecars together, and allow the configured SQLite busy timeout to work before investigating filesystem or process ownership.
- **Protocol errors:** keep stdout untouched in stdio mode. Send application diagnostics to stderr and use the structured correlation ID returned by tool failures.
- **Native SQLite installation:** if npm cannot use a prebuilt `better-sqlite3` binary for your Node version, install the platform C/C++ build prerequisites and run `npm rebuild better-sqlite3`.

More operational guidance is in [docs/operations.md](docs/operations.md). The project is intentionally read-only with respect to the marketplace and its upstream API.
