import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SETUP_CLIENTS,
  buildSetupPlan,
  createStdioServerConfig,
  parseSetupOptions,
  renderClaudeConfig,
  renderCodexConfig,
  renderClineConfig,
  renderGooseConfig,
  renderOpenCodeConfig,
  renderPiConfig,
  runSetup,
  renderVsCodeConfig,
  renderZedConfig,
} from "../../src/setup.js";
import type { SetupClient } from "../../src/setup.js";

const unavailableClients = Object.fromEntries(
  SETUP_CLIENTS.map((client) => [client, false]),
) as Record<SetupClient, boolean>;

test("setup plan uses a stable platform data directory and detects hosts", () => {
  const plan = buildSetupPlan({
    requestedClient: "auto",
    home: "/tmp/tonnel-setup-home",
    platform: "linux",
    env: {},
    entrypoint: "/opt/tonnel/dist/src/cli.js",
    projectRoot: "/opt/tonnel",
    commandAvailability: {
      ...unavailableClients,
      codex: true,
      openclaw: true,
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
  assert.deepEqual(parseSetupOptions(["--client", "generic"]), {
    requestedClient: "generic",
    dryRun: false,
    help: false,
  });
  assert.deepEqual(parseSetupOptions(["--help"]), {
    requestedClient: "auto",
    dryRun: false,
    help: true,
  });
});

test("auto detection ignores stale config files without host commands", () => {
  const home = mkdtempSync(join(tmpdir(), "tonnel-setup-home-"));
  try {
    writeFileSync(join(home, ".claude.json"), "{}\n");
    const plan = buildSetupPlan({
      requestedClient: "auto",
      home,
      platform: "linux",
      env: {},
      entrypoint: "/opt/tonnel/dist/src/cli.js",
      projectRoot: "/opt/tonnel",
      commandAvailability: unavailableClients,
    });

    assert.deepEqual(plan.clients, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("auto detection separates Gemini CLI from Antigravity", () => {
  const plan = buildSetupPlan({
    requestedClient: "auto",
    home: "/tmp/tonnel-setup-home",
    platform: "linux",
    env: {},
    entrypoint: "/opt/tonnel/dist/src/cli.js",
    projectRoot: "/opt/tonnel",
    commandAvailability: {
      ...unavailableClients,
      gemini: true,
      opencode: true,
      cursor: true,
      vscode: true,
      cline: true,
      zed: true,
      goose: true,
    },
  });

  assert.deepEqual(plan.clients, [
    "gemini",
    "opencode",
    "cursor",
    "vscode",
    "cline",
    "zed",
    "goose",
  ]);
  assert.equal(plan.clients.includes("antigravity"), false);
});

test("new client paths follow their documented user configuration locations", () => {
  const plan = buildSetupPlan({
    requestedClient: "generic",
    home: "/home/tester",
    platform: "linux",
    env: { XDG_CONFIG_HOME: "/config", CLINE_DATA_DIR: "/cline" },
    entrypoint: "/opt/tonnel/dist/src/cli.js",
    projectRoot: "/opt/tonnel",
    commandAvailability: unavailableClients,
  });

  assert.deepEqual(plan.configPaths, {
    codex: "/home/tester/.codex/config.toml",
    claude: "/home/tester/.claude.json",
    openclaw: "/home/tester/.openclaw/openclaw.json",
    antigravity: "/home/tester/.gemini/config/mcp_config.json",
    gemini: "/home/tester/.gemini/settings.json",
    opencode: "/config/opencode/opencode.json",
    cursor: "/home/tester/.cursor/mcp.json",
    windsurf: "/home/tester/.codeium/windsurf/mcp_config.json",
    vscode: "/config/Code/User/mcp.json",
    pi: "/home/tester/.pi/agent/mcp.json",
    cline: "/cline/settings/cline_mcp_settings.json",
    zed: "/config/zed/settings.json",
    goose: "/config/goose/config.yaml",
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

test("published setup uses a stable npx package command", () => {
  const npxRoot = mkdtempSync(join(tmpdir(), "tonnel-npx-setup-"));
  const packageRoot = join(npxRoot, "node_modules", "tonnel-market-mcp");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "tonnel-market-mcp", version: "0.1.3" }),
  );

  try {
    const server = createStdioServerConfig(
      join(npxRoot, "node_modules", ".bin", "tonnel-market-mcp"),
      npxRoot,
      "/data/tonnel.sqlite",
    );

    assert.equal(
      server.command,
      process.platform === "win32" ? "npx.cmd" : "npx",
    );
    assert.deepEqual(server.args, [
      "-y",
      "tonnel-market-mcp@0.1.3",
      "--transport",
      "stdio",
    ]);
    assert.equal(server.cwd, process.cwd());
  } finally {
    rmSync(npxRoot, { recursive: true, force: true });
  }
});

test("OpenCode setup migrates the previous wrapper format", async () => {
  const home = mkdtempSync(join(tmpdir(), "tonnel-opencode-setup-"));
  const xdgConfigHome = join(home, "xdg-config");
  const configPath = join(xdgConfigHome, "opencode", "opencode.json");
  mkdirSync(join(xdgConfigHome, "opencode"), { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        mcp: {
          servers: {
            "tonnel-market": { type: "local", command: ["old"] },
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  try {
    await runSetup(["--client", "opencode"], {
      ...process.env,
      TONNEL_MARKET_SETUP_HOME: home,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: join(home, "xdg-data"),
    });
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      mcp: Record<string, Record<string, unknown>>;
    };
    const serverConfig = config.mcp["tonnel-market"];
    assert.ok(serverConfig);
    assert.equal(config.mcp.servers, undefined);
    assert.equal(serverConfig.type, "local");
    assert.equal(serverConfig.enabled, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("new client renderers preserve the stdio contract", () => {
  const server = createStdioServerConfig(
    "/opt/tonnel/dist/src/cli.js",
    "/opt/tonnel",
    "/data/tonnel.sqlite",
  );

  assert.deepEqual(renderOpenCodeConfig(server), {
    type: "local",
    command: [
      process.execPath,
      "/opt/tonnel/dist/src/cli.js",
      "--transport",
      "stdio",
    ],
    cwd: "/opt/tonnel",
    environment: { TONNEL_MARKET_DB_PATH: "/data/tonnel.sqlite" },
    enabled: true,
  });
  assert.deepEqual(renderVsCodeConfig(server), {
    type: "stdio",
    command: process.execPath,
    args: ["/opt/tonnel/dist/src/cli.js", "--transport", "stdio"],
    env: { TONNEL_MARKET_DB_PATH: "/data/tonnel.sqlite" },
  });
  assert.equal(renderPiConfig(server).transport, "stdio");
  assert.equal(renderClineConfig(server).transportType, "stdio");
  assert.deepEqual(renderZedConfig(server), {
    command: process.execPath,
    args: ["/opt/tonnel/dist/src/cli.js", "--transport", "stdio"],
    env: { TONNEL_MARKET_DB_PATH: "/data/tonnel.sqlite" },
  });
  assert.deepEqual(renderGooseConfig(server), {
    name: "tonnel-market",
    type: "stdio",
    enabled: true,
    cmd: process.execPath,
    args: ["/opt/tonnel/dist/src/cli.js", "--transport", "stdio"],
    envs: { TONNEL_MARKET_DB_PATH: "/data/tonnel.sqlite" },
    timeout: 300,
  });
});
