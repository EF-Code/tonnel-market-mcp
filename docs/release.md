# Release checklist

Before a local release candidate:

```sh
npm ci
npm run verify
npm run release:preflight
npm run package:smoke
git status --short
```

Review the package file list, generated CLI path (`dist/src/cli.js`), dependency audit output, and the Git diff. Confirm that `.env`, SQLite files, notification credentials, the supplied local-only build prompt, and the supplied upstream contract are not tracked or packaged.

The live smoke check remains separate:

```sh
npm run test:live
```

An unavailable or rate-limited upstream is an external validation boundary, not a reason to claim live ingestion proof. Record the date, endpoint reachability, response shape, and any blocked check in the handoff.

## npm publication

The package is configured for public npm publication. Authenticate locally without sharing credentials with the repository or an agent:

```sh
npm login
npm whoami
```

Then publish the verified version:

```sh
npm publish --access public
npm view tonnel-market-mcp version dist-tags --json
```

`prepublishOnly` reruns verification, package-content checks, and the clean tarball smoke test before npm accepts the package. Do not publish with `--ignore-scripts`.
