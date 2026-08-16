import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, stringify } from "yaml";

import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";

export const SETUP_CLIENTS = [
  "codex",
  "claude",
  "openclaw",
  "antigravity",
  "gemini",
  "opencode",
  "cursor",
  "windsurf",
  "vscode",
  "pi",
  "cline",
  "zed",
  "goose",
] as const;

export type SetupClient = (typeof SETUP_CLIENTS)[number];

type SetupRequest = "auto" | "all" | "generic" | SetupClient;

export type SetupServerConfig = {
  command: string;
  args: string[];
  cwd: string;
  env: {
    TONNEL_MARKET_DB_PATH: string;
  };
};

export type SetupPlan = {
  clients: SetupClient[];
  databasePath: string;
  entrypoint: string;
  projectRoot: string;
  server: SetupServerConfig;
  configPaths: Record<SetupClient, string>;
};

type SetupPlanOptions = {
  requestedClient?: SetupRequest;
  home?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  entrypoint?: string;
  projectRoot?: string;
  databasePath?: string;
  commandAvailability?: Partial<Record<SetupClient, boolean>>;
};

type SetupOptions = {
  requestedClient: SetupRequest;
  databasePath?: string;
  dryRun: boolean;
  help: boolean;
};

type JsonObject = Record<string, unknown>;

const SERVER_NAME = "tonnel-market";
const PACKAGE_NAME = "tonnel-market-mcp";

export function createStdioServerConfig(
  entrypoint: string,
  projectRoot: string,
  databasePath: string,
): SetupServerConfig {
  const useNpxCommand = isNpxEntrypoint(entrypoint);
  return {
    command: useNpxCommand
      ? process.platform === "win32"
        ? "npx.cmd"
        : "npx"
      : process.execPath,
    args: useNpxCommand
      ? [
          "-y",
          `${PACKAGE_NAME}@${readPackageVersion(projectRoot, entrypoint) ?? "latest"}`,
          "--transport",
          "stdio",
        ]
      : [entrypoint, "--transport", "stdio"],
    cwd: useNpxCommand ? process.cwd() : projectRoot,
    env: {
      TONNEL_MARKET_DB_PATH: databasePath,
    },
  };
}

export function buildSetupPlan(options: SetupPlanOptions = {}): SetupPlan {
  const env = options.env ?? process.env;
  const setupHome = resolve(options.home ?? setupHomeFromEnvironment(env));
  const entrypoint = resolve(
    options.entrypoint ??
      process.argv[1] ??
      fileURLToPath(new URL("./cli.js", import.meta.url)),
  );
  const projectRoot = resolve(
    options.projectRoot ?? dirname(dirname(dirname(entrypoint))),
  );
  const databasePath = resolve(
    options.databasePath ??
      defaultDatabasePath(setupHome, options.platform, env),
  );
  const configPaths = getConfigPaths(setupHome, options.platform, env);
  const requestedClient = options.requestedClient ?? "auto";
  const clients = selectClients(requestedClient, options.commandAvailability);

  return {
    clients,
    databasePath,
    entrypoint,
    projectRoot,
    server: createStdioServerConfig(entrypoint, projectRoot, databasePath),
    configPaths,
  };
}

export function renderCodexConfig(server: SetupServerConfig): string {
  return [
    "# Added by tonnel-market-mcp setup.\n",
    "[mcp_servers.tonnel_market]",
    `command = ${tomlString(server.command)}`,
    `args = ${tomlArray(server.args)}`,
    `cwd = ${tomlString(server.cwd)}`,
    "",
    "[mcp_servers.tonnel_market.env]",
    `TONNEL_MARKET_DB_PATH = ${tomlString(server.env.TONNEL_MARKET_DB_PATH)}`,
    "",
  ].join("\n");
}

export function renderClaudeConfig(server: SetupServerConfig): JsonObject {
  return {
    type: "stdio",
    command: server.command,
    args: server.args,
    env: server.env,
  };
}

export function renderOpenClawConfig(server: SetupServerConfig): JsonObject {
  return {
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    env: server.env,
  };
}

export function renderAntigravityConfig(server: SetupServerConfig): JsonObject {
  return {
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    env: server.env,
  };
}

export function renderStandardStdioConfig(
  server: SetupServerConfig,
): JsonObject {
  return {
    command: server.command,
    args: server.args,
    env: server.env,
  };
}

export function renderOpenCodeConfig(server: SetupServerConfig): JsonObject {
  return {
    type: "local",
    command: [server.command, ...server.args],
    cwd: server.cwd,
    environment: server.env,
    enabled: true,
  };
}

export function renderVsCodeConfig(server: SetupServerConfig): JsonObject {
  return {
    type: "stdio",
    command: server.command,
    args: server.args,
    env: server.env,
  };
}

export function renderPiConfig(server: SetupServerConfig): JsonObject {
  return {
    command: server.command,
    args: server.args,
    transport: "stdio",
    lifecycle: "lazy",
    env: server.env,
  };
}

export function renderClineConfig(server: SetupServerConfig): JsonObject {
  return {
    command: server.command,
    args: server.args,
    env: server.env,
    transportType: "stdio",
  };
}

export function renderZedConfig(server: SetupServerConfig): JsonObject {
  return renderStandardStdioConfig(server);
}

export function renderGooseConfig(server: SetupServerConfig): JsonObject {
  return {
    name: SERVER_NAME,
    type: "stdio",
    enabled: true,
    cmd: server.command,
    args: server.args,
    envs: server.env,
    timeout: 300,
  };
}

export function parseSetupOptions(args: readonly string[]): SetupOptions {
  let requestedClient: SetupRequest = "auto";
  let databasePath: string | undefined;
  let dryRun = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--client") {
      const value = args[index + 1];
      if (!value) throw new Error("--client requires a value.");
      requestedClient = parseSetupRequest(value);
      index += 1;
      continue;
    }
    if (argument === "--db-path") {
      const value = args[index + 1];
      if (!value) throw new Error("--db-path requires a value.");
      databasePath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown setup option: ${argument}`);
  }

  return {
    requestedClient,
    dryRun,
    help,
    ...(databasePath ? { databasePath } : {}),
  };
}

export async function runSetup(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const options = parseSetupOptions(args);
  if (options.help) {
    printSetupHelp();
    return;
  }
  const plan = buildSetupPlan({
    requestedClient: options.requestedClient,
    env,
    ...(options.databasePath ? { databasePath: options.databasePath } : {}),
  });

  printSetupHeader(plan, options.dryRun);
  if (plan.clients.length === 0) {
    printGenericConfig(plan);
    return;
  }
  if (options.dryRun) {
    printDryRunConfigs(plan);
    return;
  }

  migrateSetupDatabase(plan.databasePath, env);
  const failures: string[] = [];
  for (const client of plan.clients) {
    try {
      configureClient(client, plan);
      printLine(`Configured ${clientLabel(client)}.`);
      printClientNote(client);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      failures.push(`${client}: ${message}`);
      printLine(`Could not configure ${client}: ${message}`);
    }
  }

  printLine("");
  printLine(`Database: ${plan.databasePath}`);
  printLine("Restart the configured agent, then ask it to call market_health.");
  if (plan.clients.length > 1) {
    printLine(
      "Several hosts were configured. Run only one stdio collector per database, or use the shared HTTP mode for simultaneous hosts.",
    );
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}

export function runDoctor(): void {
  const plan = buildSetupPlan();
  printLine("tonnel-market-mcp doctor");
  printLine(`Node: ${process.version}`);
  printLine(`Entrypoint: ${plan.entrypoint}`);
  printLine(`Database: ${plan.databasePath}`);
  printLine(
    plan.clients.length > 0
      ? `Detected hosts: ${plan.clients.map(clientLabel).join(", ")}`
      : "Detected hosts: none",
  );
  printLine("Run `tonnel-market-mcp setup` to configure detected hosts.");
}

export function printSetupHelp(): void {
  printLine("Usage: tonnel-market-mcp setup [options]");
  printLine("");
  printLine("Automatically configure detected MCP hosts for local stdio use.");
  printLine("");
  printLine("Options:");
  printLine(
    "  --client VALUE                                      Host to configure",
  );
  printLine(
    `                                                     auto, all, generic, or: ${SETUP_CLIENTS.join(", ")}`,
  );
  printLine(
    "  --db-path PATH                                      SQLite path",
  );
  printLine(
    "  --dry-run                                           Print changes only",
  );
  printLine(
    "  --help                                              Show this help",
  );
}

function setupHomeFromEnvironment(env: NodeJS.ProcessEnv): string {
  const configured = env.TONNEL_MARKET_SETUP_HOME?.trim();
  return configured || homedir();
}

function defaultDatabasePath(
  home: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dataRoot =
    platform === "win32"
      ? env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local")
      : platform === "darwin"
        ? join(home, "Library", "Application Support")
        : env.XDG_DATA_HOME?.trim() || join(home, ".local", "share");
  return join(dataRoot, "tonnel-market-mcp", "tonnel-market.sqlite");
}

function getConfigPaths(
  home: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Record<SetupClient, string> {
  const configRoot =
    platform === "win32"
      ? env.APPDATA?.trim() || join(home, "AppData", "Roaming")
      : env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
  const vscodeConfigRoot =
    platform === "darwin"
      ? join(home, "Library", "Application Support")
      : configRoot;
  const gooseConfigRoot =
    platform === "win32"
      ? join(
          env.APPDATA?.trim() || join(home, "AppData", "Roaming"),
          "Block",
          "goose",
          "config",
        )
      : join(configRoot, "goose");
  const clineDataRoot =
    env.CLINE_DATA_DIR?.trim() || join(home, ".cline", "data");

  return {
    codex: join(home, ".codex", "config.toml"),
    claude: join(home, ".claude.json"),
    openclaw: join(home, ".openclaw", "openclaw.json"),
    antigravity: join(home, ".gemini", "config", "mcp_config.json"),
    gemini: join(home, ".gemini", "settings.json"),
    opencode: join(configRoot, "opencode", "opencode.json"),
    cursor: join(home, ".cursor", "mcp.json"),
    windsurf: join(home, ".codeium", "windsurf", "mcp_config.json"),
    vscode: join(vscodeConfigRoot, "Code", "User", "mcp.json"),
    pi: join(home, ".pi", "agent", "mcp.json"),
    cline: join(clineDataRoot, "settings", "cline_mcp_settings.json"),
    zed: join(configRoot, "zed", "settings.json"),
    goose: join(gooseConfigRoot, "config.yaml"),
  };
}

function selectClients(
  requestedClient: SetupRequest,
  commandAvailability?: Partial<Record<SetupClient, boolean>>,
): SetupClient[] {
  if (requestedClient === "all") return [...SETUP_CLIENTS];
  if (requestedClient === "generic") return [];
  if (requestedClient !== "auto") return [requestedClient];

  return SETUP_CLIENTS.filter((client) => {
    const explicitlyAvailable = commandAvailability?.[client];
    if (explicitlyAvailable !== undefined) return explicitlyAvailable;
    return clientCommandAvailable(client);
  });
}

function clientLabel(client: SetupClient): string {
  return {
    codex: "Codex",
    claude: "Claude Code",
    openclaw: "OpenClaw",
    antigravity: "Antigravity",
    gemini: "Gemini CLI",
    opencode: "OpenCode",
    cursor: "Cursor",
    windsurf: "Windsurf",
    vscode: "VS Code",
    pi: "Pi",
    cline: "Cline",
    zed: "Zed",
    goose: "Goose",
  }[client];
}

function clientCommandAvailable(client: SetupClient): boolean {
  return findExecutableOnPath(clientCommands(client)) !== undefined;
}

function clientCommands(client: SetupClient): string[] {
  return {
    codex: ["codex"],
    claude: ["claude"],
    openclaw: ["openclaw"],
    antigravity: ["antigravity", "agy"],
    gemini: ["gemini"],
    opencode: ["opencode"],
    cursor: ["cursor", "cursor-agent"],
    windsurf: ["windsurf"],
    vscode: ["code", "code-insiders"],
    pi: ["pi"],
    cline: ["cline"],
    zed: ["zed"],
    goose: ["goose"],
  }[client];
}

function findExecutableOnPath(commands: readonly string[]): string | undefined {
  return commands.find((command) => executableOnPath(command));
}

function executableOnPath(command: string): boolean {
  try {
    execFileSync(
      process.platform === "win32" ? "where.exe" : "which",
      [command],
      {
        stdio: "ignore",
      },
    );
    return true;
  } catch {
    return false;
  }
}

function configureClient(client: SetupClient, plan: SetupPlan): void {
  switch (client) {
    case "codex":
      writeCodexConfig(plan.configPaths.codex, plan.server);
      return;
    case "claude":
      updateJsonConfig(
        plan.configPaths.claude,
        ["mcpServers", SERVER_NAME],
        renderClaudeConfig(plan.server),
      );
      return;
    case "openclaw":
      configureOpenClaw(plan);
      return;
    case "antigravity":
      updateJsonConfig(
        plan.configPaths.antigravity,
        ["mcpServers", SERVER_NAME],
        renderAntigravityConfig(plan.server),
      );
      return;
    case "gemini":
      updateJsonConfig(
        plan.configPaths.gemini,
        ["mcpServers", SERVER_NAME],
        renderStandardStdioConfig(plan.server),
      );
      return;
    case "opencode":
      configureOpenCode(plan);
      return;
    case "cursor":
    case "windsurf":
    case "pi":
      updateJsonConfig(
        plan.configPaths[client],
        ["mcpServers", SERVER_NAME],
        client === "pi"
          ? renderPiConfig(plan.server)
          : renderStandardStdioConfig(plan.server),
      );
      return;
    case "vscode":
      configureVsCode(plan);
      return;
    case "cline":
      updateJsonConfig(
        plan.configPaths.cline,
        ["mcpServers", SERVER_NAME],
        renderClineConfig(plan.server),
      );
      return;
    case "zed":
      updateJsonConfig(
        plan.configPaths.zed,
        ["context_servers", SERVER_NAME],
        renderZedConfig(plan.server),
      );
      return;
    case "goose":
      updateYamlConfig(
        plan.configPaths.goose,
        ["extensions", SERVER_NAME],
        renderGooseConfig(plan.server),
      );
      return;
  }
}

function configureOpenCode(plan: SetupPlan): void {
  const path = plan.configPaths.opencode;
  const root = readJsonObject(path);
  const existingMcp = root.mcp;
  if (existingMcp !== undefined && !isJsonObject(existingMcp)) {
    throw new Error(`${path} has a non-object mcp value.`);
  }
  const mcp = existingMcp ?? {};
  const existingServers = mcp.servers;
  if (existingServers !== undefined) {
    if (!isJsonObject(existingServers)) {
      throw new Error(`${path} has a non-object mcp.servers value.`);
    }
    const otherServers = Object.keys(existingServers).filter(
      (name) => name !== SERVER_NAME,
    );
    if (otherServers.length > 0) {
      throw new Error(
        `${path} uses OpenCode V2's mcp.servers format for other servers; migrate those entries before running setup.`,
      );
    }
    delete mcp.servers;
  }
  mcp[SERVER_NAME] = renderOpenCodeConfig(plan.server);
  root.mcp = mcp;
  writeTextFile(path, `${JSON.stringify(root, null, 2)}\n`);
}

function configureVsCode(plan: SetupPlan): void {
  const command = findExecutableOnPath(clientCommands("vscode"));
  if (command) {
    try {
      backupConfigOnce(plan.configPaths.vscode);
      execFileSync(
        command,
        [
          "--add-mcp",
          JSON.stringify({
            name: SERVER_NAME,
            ...renderVsCodeConfig(plan.server),
          }),
        ],
        { stdio: "ignore" },
      );
      return;
    } catch {
      // Fall back to the documented user mcp.json location below.
    }
  }
  updateJsonConfig(
    plan.configPaths.vscode,
    ["servers", SERVER_NAME],
    renderVsCodeConfig(plan.server),
  );
}

function configureOpenClaw(plan: SetupPlan): void {
  const config = renderOpenClawConfig(plan.server);
  if (executableOnPath("openclaw")) {
    execFileSync(
      "openclaw",
      ["mcp", "set", SERVER_NAME, JSON.stringify(config)],
      {
        stdio: "ignore",
      },
    );
    return;
  }
  updateJsonConfig(
    plan.configPaths.openclaw,
    ["mcp", "servers", SERVER_NAME],
    config,
  );
}

function migrateSetupDatabase(
  databasePath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const config = loadConfig({
    ...env,
    TONNEL_MARKET_DB_PATH: databasePath,
    TONNEL_MARKET_LOG_LEVEL: "error",
    TONNEL_MARKET_MCP_TRANSPORT: "stdio",
  });
  const runtime = createRuntime(config);
  runtime.close();
}

function writeCodexConfig(path: string, server: SetupServerConfig): void {
  const source = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeTextFile(
    path,
    upsertTomlTable(
      source,
      "mcp_servers.tonnel_market",
      renderCodexConfig(server),
    ),
  );
}

function upsertTomlTable(
  source: string,
  tableName: string,
  replacement: string,
): string {
  const lines = source.split(/\r?\n/u);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*$/u.exec(line)?.[1];
    if (header !== undefined) {
      skipping = header === tableName || header.startsWith(`${tableName}.`);
      if (!skipping) kept.push(line);
      continue;
    }
    if (!skipping) kept.push(line);
  }

  const prefix = kept.join("\n").replace(/\n*$/u, "");
  return `${prefix ? `${prefix}\n\n` : ""}${replacement}`;
}

function updateJsonConfig(
  path: string,
  segments: string[],
  value: JsonObject,
): void {
  const root = readJsonObject(path);
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (existing === undefined) {
      const child: JsonObject = {};
      current[segment] = child;
      current = child;
    } else if (isJsonObject(existing)) {
      current = existing;
    } else {
      throw new Error(`${path} has a non-object ${segment} value.`);
    }
  }
  const finalSegment = segments.at(-1);
  if (!finalSegment) throw new Error("A JSON configuration path is required.");
  current[finalSegment] = value;
  writeTextFile(path, `${JSON.stringify(root, null, 2)}\n`);
}

function updateYamlConfig(
  path: string,
  segments: string[],
  value: JsonObject,
): void {
  const source = existsSync(path) ? readFileSync(path, "utf8") : "";
  const document = parseDocument(source || "{}\n");
  if (document.errors.length > 0) {
    throw new Error(
      `${path} is not valid YAML; use Goose's configuration screen to add tonnel-market.`,
    );
  }
  document.setIn(segments, value);
  writeTextFile(path, document.toString());
}

function readJsonObject(path: string): JsonObject {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `${path} is not plain JSON; use the host's MCP command to add tonnel-market.`,
      { cause: error },
    );
  }
  if (!isJsonObject(parsed))
    throw new Error(`${path} must contain a JSON object.`);
  return parsed;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeTextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  backupConfigOnce(path);
  const existingMode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, content, {
    encoding: "utf8",
    mode: existingMode,
  });
  renameSync(temporaryPath, path);
  chmodSync(path, existingMode);
}

function backupConfigOnce(path: string): void {
  if (!existsSync(path)) return;
  const backupPath = `${path}.tonnel-market-mcp.bak`;
  if (!existsSync(backupPath)) copyFileSync(path, backupPath);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: readonly string[]): string {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

function printSetupHeader(plan: SetupPlan, dryRun: boolean): void {
  printLine(`tonnel-market-mcp ${dryRun ? "setup preview" : "setup"}`);
  printLine(`Database: ${plan.databasePath}`);
  printLine(
    plan.clients.length > 0
      ? `Hosts: ${plan.clients.map(clientLabel).join(", ")}`
      : "Hosts: none will be configured; printing a generic MCP config",
  );
  printLine("");
}

function printDryRunConfigs(plan: SetupPlan): void {
  for (const client of plan.clients) {
    printLine(`--- ${client}: ${plan.configPaths[client]} ---`);
    if (client === "codex") {
      printLine(renderCodexConfig(plan.server));
    } else if (client === "goose") {
      printLine(
        `extensions:\n  ${SERVER_NAME}:\n${indentText(
          toYaml(renderGooseConfig(plan.server)),
          4,
        )}`,
      );
    } else {
      printLine(
        JSON.stringify(renderClientConfig(client, plan.server), null, 2),
      );
    }
  }
}

function renderClientConfig(
  client: Exclude<SetupClient, "codex" | "goose">,
  server: SetupServerConfig,
): JsonObject {
  switch (client) {
    case "claude":
      return renderClaudeConfig(server);
    case "openclaw":
      return renderOpenClawConfig(server);
    case "antigravity":
      return renderAntigravityConfig(server);
    case "gemini":
    case "cursor":
    case "windsurf":
      return renderStandardStdioConfig(server);
    case "opencode":
      return renderOpenCodeConfig(server);
    case "vscode":
      return renderVsCodeConfig(server);
    case "pi":
      return renderPiConfig(server);
    case "cline":
      return renderClineConfig(server);
    case "zed":
      return renderZedConfig(server);
  }
  throw new Error(`Unsupported setup client: ${client}`);
}

function toYaml(value: JsonObject): string {
  return stringify(value).trimEnd();
}

function indentText(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function printClientNote(client: SetupClient): void {
  if (client === "pi") {
    printLine(
      "Pi note: install `pi install npm:pi-mcp-extension` if Pi does not already have MCP support enabled.",
    );
  }
  if (client === "goose") {
    printLine("Goose exposes this MCP server as a stdio extension.");
  }
}

function printGenericConfig(plan: SetupPlan): void {
  printLine("No host will be configured. Add this MCP server manually:");
  printLine(
    JSON.stringify(
      {
        mcpServers: {
          [SERVER_NAME]: {
            command: plan.server.command,
            args: plan.server.args,
            cwd: plan.server.cwd,
            env: plan.server.env,
          },
        },
      },
      null,
      2,
    ),
  );
}

function printLine(value = ""): void {
  process.stdout.write(`${value}\n`);
}

function parseSetupRequest(value: string): SetupRequest {
  if (
    value === "auto" ||
    value === "all" ||
    value === "generic" ||
    SETUP_CLIENTS.includes(value as SetupClient)
  ) {
    return value as SetupRequest;
  }
  throw new Error(
    `--client must be auto, all, generic, ${SETUP_CLIENTS.join(", ")}.`,
  );
}

function isNpxEntrypoint(entrypoint: string): boolean {
  const normalized = entrypoint.replaceAll("\\", "/");
  return (
    normalized.includes("/.npm/_npx/") ||
    normalized.includes("/node_modules/.bin/tonnel-market-mcp")
  );
}

function readPackageVersion(
  projectRoot: string,
  entrypoint?: string,
): string | undefined {
  const packageManifests = [join(projectRoot, "package.json")];
  if (entrypoint && isNpxEntrypoint(entrypoint)) {
    packageManifests.push(
      join(dirname(dirname(entrypoint)), PACKAGE_NAME, "package.json"),
    );
  }

  for (const packageManifest of packageManifests) {
    try {
      const parsed = JSON.parse(
        readFileSync(packageManifest, "utf8"),
      ) as unknown;
      if (isJsonObject(parsed) && typeof parsed.version === "string") {
        return parsed.version;
      }
    } catch {
      // A source checkout or unusual launcher may not have a package manifest here.
    }
  }
  return undefined;
}
