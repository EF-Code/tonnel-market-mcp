# Getting started

The easiest path is to let the installer configure the MCP host for you.

## One-command setup from npm

After the package is published, run:

```sh
npx -y tonnel-market-mcp setup
```

The command downloads the package, builds no local source checkout, detects supported MCP hosts, and writes their local stdio configuration. Node.js 22 or newer is required.

## Source installation from GitHub

```sh
git clone https://github.com/EF-Code/tonnel-market-mcp.git
cd tonnel-market-mcp
node scripts/install.mjs
```

The installer:

- checks that Node.js 22 or newer is available;
- installs the locked dependencies;
- builds the MCP server;
- creates and migrates the SQLite database;
- detects Codex, Claude Code, OpenClaw, and Antigravity; and
- writes a local stdio configuration for each detected host.

When an existing host configuration is updated, the installer keeps a first-run backup beside it with the suffix `.tonnel-market-mcp.bak`.

Restart the host after the installer finishes. A useful first request is:

```text
Use tonnel-market and call market_health first. Explain whether the collector is connected, how much coverage is available, and whether the result may be incomplete.
```

## Installer options

Configure one specific host:

```sh
node scripts/install.mjs --client codex
```

Preview the files without changing anything:

```sh
node scripts/install.mjs --dry-run
```

Choose a specific database path:

```sh
node scripts/install.mjs --db-path /absolute/path/to/tonnel-market.sqlite
```

If no supported host is detected, copy the generic configuration printed by the installer into the MCP client's server settings. The generated server uses stdio, so the host starts and stops it automatically.

## Using several hosts at once

Do not run several stdio collectors against the same database simultaneously. For Codex, Claude Code, OpenClaw, and Antigravity running at the same time, start one shared Streamable HTTP server and point each host at `http://127.0.0.1:8787/mcp`:

```sh
export TONNEL_MARKET_HTTP_TOKEN='use-a-long-random-secret'
TONNEL_MARKET_HTTP_TOKEN="$TONNEL_MARKET_HTTP_TOKEN" npm run start:http
```

Read [operations.md](operations.md) and [security.md](security.md) before binding HTTP outside loopback. HTTP is a controlled deployment boundary, not an OAuth authorization server.

## What the server can do

The server exposes bounded market search, gift history, sales summaries, auction status, evidence-bounded opportunity screens, health/coverage information, local alert rules, resources, and reusable prompts. It does not connect wallets, sign messages, place orders, bid, buy, sell, or transfer assets.

Results can be incomplete because the upstream replay window is approximately seven days and does not provide a complete active-market snapshot. Use `market_health` or `market://coverage` before relying on a result.

For manual host configuration and the complete MCP surface, see the [README](../README.md) and [tool reference](tool-reference.md).
