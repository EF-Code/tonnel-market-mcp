import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSetupPlan,
  createStdioServerConfig,
  parseSetupOptions,
  renderClaudeConfig,
  renderCodexConfig,
} from "../../src/setup.js";

test("setup plan uses a stable platform data directory and detects hosts", () => {
  const plan = buildSetupPlan({
    requestedClient: "auto",
    home: "/tmp/tonnel-setup-home",
    platform: "linux",
    env: {},
    entrypoint: "/opt/tonnel/dist/src/cli.js",
    projectRoot: "/opt/tonnel",
    commandAvailability: {
      codex: true,
      claude: false,
      openclaw: true,
      antigravity: false,
    },
  });

  assert.deepEqual(plan.clients, ["codex", "openclaw"]);
  assert.equal(
    plan.databasePath,
    "/tmp/tonnel-setup-home/.local/share/tonnel-market-mcp/tonnel-market.sqlite",
  );
  assert.equal(plan.server.args[0], "/opt/tonnel/dist/src/cli.js");
  assert.equal(plan.server.cwd, "/opt/tonnel");
});

test("setup option parsing supports noob-friendly defaults and previews", () => {
  assert.deepEqual(parseSetupOptions([]), {
    requestedClient: "auto",
    dryRun: false,
    help: false,
  });
  assert.deepEqual(parseSetupOptions(["--client", "codex", "--dry-run"]), {
    requestedClient: "codex",
    dryRun: true,
    help: false,
  });
  assert.deepEqual(parseSetupOptions(["--help"]), {
    requestedClient: "auto",
    dryRun: false,
    help: true,
  });
});

test("host configuration renders the same stdio server contract", () => {
  const server = createStdioServerConfig(
    "/opt/tonnel/dist/src/cli.js",
    "/opt/tonnel",
    "/data/tonnel.sqlite",
  );

  assert.deepEqual(renderClaudeConfig(server), {
    type: "stdio",
    command: process.execPath,
    args: ["/opt/tonnel/dist/src/cli.js", "--transport", "stdio"],
    env: { TONNEL_MARKET_DB_PATH: "/data/tonnel.sqlite" },
  });
  assert.match(renderCodexConfig(server), /\[mcp_servers\.tonnel_market\]/u);
  assert.match(
    renderCodexConfig(server),
    /TONNEL_MARKET_DB_PATH = ".*tonnel\.sqlite"/u,
  );
});
