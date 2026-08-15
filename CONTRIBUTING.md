# Contributing

Use Node.js 22 or newer and the repository's pinned npm dependency graph.

```sh
npm ci
npm run verify
```

Keep changes separated by boundary: domain/schema, storage, ingestion, analytics, MCP presentation, transport, tests, and documentation. Add deterministic fixtures or mock servers for behavior that would otherwise depend on the public upstream. Never add credentials, private paths, database files, or the supplied local-only build materials.

Pull requests should describe coverage changes and identify any behavior that remains unverified against the live service. Do not add wallet operations, marketplace mutations, identity enrichment, arbitrary URL fetching, arbitrary SQL, or arbitrary shell execution to MCP tools.
