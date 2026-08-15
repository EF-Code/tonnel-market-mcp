import {
  serveStdio,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";

import { createMcpServer } from "../mcp/server.js";
import type { RuntimeServices } from "../runtime.js";

export function startStdio(services: RuntimeServices): StdioServerHandle {
  return serveStdio(() => createMcpServer(services), {
    legacy: "serve",
    onerror: (error) =>
      services.logger.error("MCP stdio protocol error", {
        message: error.message,
      }),
  });
}
