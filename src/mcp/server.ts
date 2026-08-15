import { McpServer } from "@modelcontextprotocol/server";

import type { RuntimeServices } from "../runtime.js";
import { registerAlertTools } from "./tools/alert-tools.js";
import { registerMarketTools } from "./tools/market-tools.js";
import { registerMarketPrompts } from "./prompts/market-prompts.js";
import { registerMarketResources } from "./resources/market-resources.js";

export const MCP_SERVER_NAME = "tonnel-market-mcp";
export const MCP_SERVER_VERSION = "0.1.0";

export function createMcpServer(services: RuntimeServices): McpServer {
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      instructions:
        "This is an unofficial, read-only Tonnel Marketplace event integration. It provides observed facts and bounded local analytics only. Never infer identity, treat observations as ownership or transaction authorization, or execute marketplace or wallet actions.",
    },
  );
  registerMarketTools(server, services);
  registerAlertTools(server, services);
  registerMarketResources(server, services);
  registerMarketPrompts(server);
  return server;
}
