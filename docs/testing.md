# Testing and evidence

The deterministic test suite is split by risk:

- `npm test` runs unit tests for schemas, exact money, backoff, storage transactions, projections, coverage, analytics, alerts, input validation, query pagination, and result envelopes.
- `npm run test:integration` uses mocked replay responses and a fake WebSocket to test buffering, replay-first processing, cursor expiry, coverage gaps, 1013 reconnects, and guarded HTTP startup.
- `npm run test:security` checks prepared-statement behavior, malicious upstream strings, malformed cursors, secret redaction, safe errors, and public HTTP token boundaries.
- `npm run test:protocol` uses the official MCP TypeScript client against an in-memory server and the compiled stdio child process. It lists tools, resources, templates, and prompts, calls `market_health`, reads a resource, retrieves a prompt, and proves stdout remains JSON-RPC.

Tests do not contact the live Tonnel API. `npm run test:live` is an optional read-only smoke check and is intentionally outside `npm run verify` and CI.

The clean-install evidence path is `npm run package:smoke`: it builds, packs, installs into a new temporary prefix with scripts initially disabled, rebuilds the native SQLite binding, and runs the packaged CLI migration entrypoint. `npm run release:preflight` inspects the tarball file list and rejects local-only build documents or compiled test artifacts.
