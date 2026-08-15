import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig, replayEndpoint } from "../../src/config.js";

test("configuration keeps endpoint overrides portable and validates transport values", () => {
  const config = loadConfig({
    TONNEL_MARKET_API_BASE: "https://api.example.test/",
    TONNEL_MARKET_WS_URL: "wss://stream.example.test/ws/",
    TONNEL_MARKET_DB_PATH: ".data/test.sqlite",
    TONNEL_MARKET_LOG_LEVEL: "debug",
    TONNEL_MARKET_MCP_TRANSPORT: "http",
    TONNEL_MARKET_HTTP_HOST: "127.0.0.1",
    TONNEL_MARKET_HTTP_PORT: "9000",
    TONNEL_MARKET_HTTP_PUBLIC: "false",
  });
  assert.equal(config.apiBase, "https://api.example.test");
  assert.equal(config.websocketUrl, "wss://stream.example.test/ws");
  assert.equal(config.httpPort, 9000);
  assert.equal(
    replayEndpoint(config),
    "https://api.example.test/api/marketplace/events",
  );
});

test("configuration rejects non-HTTP API and invalid ports", () => {
  assert.throws(
    () =>
      loadConfig({
        TONNEL_MARKET_API_BASE: "ftp://api.example.test",
      }),
    /must use https: or http:/u,
  );
  assert.throws(
    () => loadConfig({ TONNEL_MARKET_HTTP_PORT: "70000" }),
    /between 1 and 65535/u,
  );
});
