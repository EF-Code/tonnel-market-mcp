import assert from "node:assert/strict";
import test from "node:test";

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("stdio transport keeps stdout available for MCP JSON-RPC", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tonnel-market-mcp-stdio-"));
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  Object.assign(environment, {
    TONNEL_MARKET_API_BASE: "https://example.test",
    TONNEL_MARKET_WS_URL: "wss://127.0.0.1:1/unavailable",
    TONNEL_MARKET_DB_PATH: join(directory, "market.sqlite"),
    TONNEL_MARKET_LOG_LEVEL: "error",
    TONNEL_MARKET_MCP_TRANSPORT: "stdio",
    TONNEL_MARKET_HTTP_HOST: "127.0.0.1",
    TONNEL_MARKET_HTTP_PORT: "8787",
    TONNEL_MARKET_HTTP_PUBLIC: "false",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/src/cli.js", "--transport", "stdio"],
    cwd: process.cwd(),
    env: environment,
    stderr: "pipe",
  });
  const client = new Client({ name: "stdio-protocol-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "market_health"));
    assert.equal(transport.pid === null, false);
  } finally {
    await client.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
