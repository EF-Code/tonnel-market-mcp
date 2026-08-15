import assert from "node:assert/strict";
import test from "node:test";

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { loadConfig } from "../../src/config.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { createRuntime } from "../../src/runtime.js";

test("official MCP client can discover and invoke the server contract", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tonnel-market-mcp-protocol-"));
  const runtime = createRuntime(
    loadConfig({
      TONNEL_MARKET_API_BASE: "https://example.test",
      TONNEL_MARKET_WS_URL: "wss://example.test/ws",
      TONNEL_MARKET_DB_PATH: join(directory, "market.sqlite"),
      TONNEL_MARKET_LOG_LEVEL: "error",
      TONNEL_MARKET_MCP_TRANSPORT: "stdio",
      TONNEL_MARKET_HTTP_HOST: "127.0.0.1",
      TONNEL_MARKET_HTTP_PORT: "8787",
      TONNEL_MARKET_HTTP_PUBLIC: "false",
    }),
  );
  const server = createMcpServer(runtime);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "tonnel-market-mcp-protocol-test",
    version: "1.0.0",
  });

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(toolNames, [
      "market_auction_status",
      "market_create_alert",
      "market_delete_alert",
      "market_find_opportunities",
      "market_gift_history",
      "market_health",
      "market_list_alerts",
      "market_sales_summary",
      "market_search",
      "market_test_alert",
    ]);

    const resources = await client.listResources();
    assert.deepEqual(
      resources.resources.map((resource) => resource.uri).sort(),
      ["market://coverage", "market://schema/events", "market://stats/24h"],
    );
    const templates = await client.listResourceTemplates();
    assert.deepEqual(
      templates.resourceTemplates
        .map((template) => template.uriTemplate)
        .sort(),
      [
        "market://auction/{auction_id}",
        "market://gift/{gift_id}/timeline",
        "market://reports/daily/{date}",
      ],
    );

    const prompts = await client.listPrompts();
    assert.deepEqual(prompts.prompts.map((prompt) => prompt.name).sort(), [
      "auction_watch_report",
      "compare_gifts",
      "daily_market_brief",
    ]);

    const health = await client.callTool({
      name: "market_health",
      arguments: {},
    });
    assert.equal(health.isError, undefined);
    assert.equal(typeof health.structuredContent, "object");
    const healthData = health.structuredContent as {
      data?: { migrationVersion?: number };
    };
    assert.equal(healthData.data?.migrationVersion, 1);

    const coverage = await client.readResource({ uri: "market://coverage" });
    assert.equal(coverage.contents.length, 1);
    assert.equal(coverage.contents[0]?.mimeType, "application/json");

    const prompt = await client.getPrompt({
      name: "daily_market_brief",
      arguments: { hours: "24" },
    });
    const promptContent = prompt.messages[0]?.content;
    assert.equal(promptContent?.type, "text");
    if (promptContent?.type === "text") {
      assert.match(promptContent.text, /last 24 hours/u);
    }
  } finally {
    await client.close();
    await server.close();
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
