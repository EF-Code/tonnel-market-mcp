# Operations

## Startup and migration

```sh
npm ci
npm run build
npm run migrate
npm run start:stdio
```

Migrations are applied transactionally and report a numeric schema version. The process creates the parent directory for a file-backed database. Keep one collector per database path; multiple MCP readers are safe, but two collectors compete for the same upstream/checkpoint ownership.

## Backups

Stop the collector before copying the database and its WAL sidecars, or use SQLite's backup API through an operational procedure that understands WAL. Back up `.data/tonnel-market.sqlite` before migrations and retain the backup outside the repository. Raw events are the evidence base; normalized projections can be rebuilt by a future migration, but the current process does not expose a destructive rebuild command.

## Health and recovery

Use `market_health` or `market://coverage` to inspect:

- WebSocket state and last upstream server time.
- Last received and committed times/event ID.
- Replay state and cursor-expiry count.
- Duplicate, unknown-event, and processing-error counters.
- Coverage mode and overlapping gaps.

On an expired cursor, the collector records a gap, replays from the retention boundary, and resumes. A gap is expected to remain visible; do not remove it to make a result look complete.

If a projection fails, the event transaction rolls back and the raw row is marked failed with a bounded diagnostic. Restarting retries the event safely. Investigate repeated failures with the correlation ID and stderr logs without exposing raw credentials.

## Logging

Stdio uses stdout exclusively for MCP JSON-RPC. Application logs are stderr. File paths, causes, authorization headers, and notification tokens must not be copied into MCP output or issue reports.

## HTTP deployment

Keep the default loopback binding for local clients. A controlled remote deployment should use HTTPS termination, a private network or allowlist, an explicit bearer token or full authorization layer, origin/host restrictions, rate limiting, request-size limits, and monitoring. The bundled HTTP mode intentionally does not claim to provide OAuth authorization.

## Verification and live checks

`npm run verify` runs format, lint, typecheck, unit, integration, security, protocol, and production-build checks without the upstream. `npm run release:preflight` checks package contents. `npm run test:live` is an optional read-only smoke check and can report upstream unavailability; it is not a readiness or inclusion/finality proof.
