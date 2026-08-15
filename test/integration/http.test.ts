import assert from "node:assert/strict";
import test from "node:test";

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig } from "../../src/config.js";
import { startHttp } from "../../src/transport/http.js";
import { createRuntime } from "../../src/runtime.js";

test("HTTP transport starts on loopback and rejects non-MCP origins", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tonnel-market-mcp-http-"));
  const runtime = createRuntime(
    loadConfig({
      TONNEL_MARKET_API_BASE: "https://example.test",
      TONNEL_MARKET_WS_URL: "wss://example.test/ws",
      TONNEL_MARKET_DB_PATH: join(directory, "market.sqlite"),
      TONNEL_MARKET_LOG_LEVEL: "error",
      TONNEL_MARKET_MCP_TRANSPORT: "http",
      TONNEL_MARKET_HTTP_HOST: "127.0.0.1",
      TONNEL_MARKET_HTTP_PORT: "8787",
      TONNEL_MARKET_HTTP_PUBLIC: "false",
    }),
  );
  const server = await startHttp(runtime, {
    ...runtime.config,
    httpPort: 0,
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const notFound = await fetch(`${baseUrl}/not-mcp`);
    assert.equal(notFound.status, 404);
    assert.equal(notFound.headers.get("x-content-type-options"), "nosniff");

    const rejectedOrigin = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: "{}",
    });
    assert.ok([400, 403].includes(rejectedOrigin.status));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
