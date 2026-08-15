import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), "tonnel-market-package-"));
const installDir = join(workspace, "install");
const npmEnv = { ...process.env, npm_config_dry_run: "false" };

try {
  execFileSync("npm", ["run", "build"], {
    cwd: root,
    env: npmEnv,
    stdio: "inherit",
  });
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", workspace],
    { cwd: root, env: npmEnv, stdio: "inherit" },
  );
  const tarball = readdirSync(workspace).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack did not create a tarball");

  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installDir,
      join(workspace, tarball),
    ],
    { cwd: root, env: npmEnv, stdio: "inherit" },
  );
  execFileSync("npm", ["rebuild", "--prefix", installDir, "better-sqlite3"], {
    cwd: root,
    env: npmEnv,
    stdio: "inherit",
  });

  const cli = join(
    installDir,
    "node_modules",
    "tonnel-market-mcp",
    "dist",
    "src",
    "cli.js",
  );
  execFileSync(process.execPath, [cli, "--migrate-only"], {
    cwd: installDir,
    env: {
      ...process.env,
      TONNEL_MARKET_API_BASE: "https://example.test",
      TONNEL_MARKET_WS_URL: "wss://example.test/ws",
      TONNEL_MARKET_DB_PATH: join(installDir, "smoke.sqlite"),
      TONNEL_MARKET_LOG_LEVEL: "error",
      TONNEL_MARKET_MCP_TRANSPORT: "stdio",
      TONNEL_MARKET_HTTP_HOST: "127.0.0.1",
      TONNEL_MARKET_HTTP_PORT: "8787",
      TONNEL_MARKET_HTTP_PUBLIC: "false",
    },
    stdio: "inherit",
  });
  console.log(
    "package smoke: clean tarball installation migrated successfully",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
