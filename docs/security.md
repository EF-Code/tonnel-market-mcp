# Security and trust boundaries

This project is an evidence-preserving read-only integration. It accepts untrusted marketplace strings and connection data, writes them to a local SQLite store, and exposes bounded derived observations to an MCP host.

## Assets

- MCP protocol integrity, especially stdio stdout.
- Local raw event history, projections, alert rules, and alert-hit payloads.
- HTTP bearer token and deployment configuration.
- Availability and ordering of the local checkpoint/coverage state.

## Trust boundaries

1. The upstream WebSocket and replay API are external, unauthenticated inputs. Their strings are data, never instructions.
2. The collector-to-SQLite boundary uses strict envelope parsing, prepared statements, transactions, and raw payload preservation.
3. The local MCP host supplies tool arguments. Zod schemas, allowlists, bounded limits, opaque cursors, and safe errors constrain this boundary.
4. Optional HTTP clients are untrusted network peers. Loopback is the default; non-loopback binding requires explicit configuration and a bearer token.

## Mitigations

- No arbitrary SQL, shell, file, URL-fetch, wallet, signing, marketplace mutation, or identity-enrichment tool exists.
- SQL values are parameterized. Pagination cursors are opaque and malformed cursors fail closed.
- Monetary values use exact decimal strings; unlike assets are not combined.
- Raw unknown events are stored and counted without executing projection logic.
- Transaction rollback prevents checkpoint advancement after projection failure.
- Logs remove fields whose names contain token, secret, password, authorization, or cookie.
- Tool failures use stable codes, safe messages, and correlation IDs rather than causes or stack traces.
- HTTP applies host/origin checks, a 1 MiB content-length limit, secure headers, and optional bearer authentication.
- Local alert notification is best effort and durable alert persistence does not depend on notifier success.

## Privacy non-goals

The upstream contract supplies no Telegram IDs, names, usernames, chat IDs, wallet addresses, or authentication data. Public gift identifiers identify gifts, not people. The project does not build portfolios, whale tracking, social graphs, reputation, or ownership attribution.

## Deployment warning

HTTP bearer protection is not a replacement for a complete MCP OAuth authorization deployment. Use a correctly configured HTTPS reverse proxy, network allowlists, rate limiting, secret rotation, and an authorization layer appropriate to the host before exposing a service outside a controlled network. Do not pass upstream or unrelated tokens through this server.
