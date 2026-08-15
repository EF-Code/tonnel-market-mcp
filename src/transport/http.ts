import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";

import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";

import type { AppConfig } from "../config.js";
import type { RuntimeServices } from "../runtime.js";
import { createMcpServer } from "../mcp/server.js";

const MAX_REQUEST_BYTES = 1_048_576;

export async function startHttp(
  services: RuntimeServices,
  config: AppConfig,
): Promise<ReturnType<typeof createServer>> {
  const handler = createMcpHandler(() => createMcpServer(services), {
    legacy: "stateless",
    responseMode: "json",
    onerror: (error) =>
      services.logger.error("MCP HTTP protocol error", {
        message: error.message,
      }),
  });
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) =>
      services.logger.error("MCP HTTP adapter error", {
        message: error.message,
      }),
  });
  const hostGuard = hostHeaderValidation([
    config.httpHost,
    "localhost",
    "127.0.0.1",
    "[::1]",
  ]);
  const originGuard = originValidation([
    config.httpHost,
    "localhost",
    "127.0.0.1",
    "[::1]",
  ]);
  const server = createServer((request, response) => {
    setSecurityHeaders(response);
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/mcp") {
      respond(response, 404, { error: "Not found" });
      return;
    }
    if (!isRequestSmallEnough(request)) {
      respond(response, 413, {
        error: "Request body exceeds the configured limit.",
      });
      return;
    }
    if (!hostGuard(request, response)) return;
    if (!originGuard(request, response)) return;
    if (typeof request.method !== "string") {
      respond(response, 400, { error: "HTTP method is required." });
      return;
    }
    if (config.httpToken && !hasBearerToken(request, config.httpToken)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      respond(response, 401, { error: "Authentication required." });
      return;
    }
    void nodeHandler(
      request as unknown as Parameters<typeof nodeHandler>[0],
      response,
    );
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.httpPort, config.httpHost);
  });
  services.logger.info("MCP Streamable HTTP server listening", {
    host: config.httpHost,
    port: config.httpPort,
    public: config.httpPublic,
  });
  return server;
}

function hasBearerToken(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length));
  const actual = Buffer.from(expected);
  return provided.length === actual.length && timingSafeEqual(provided, actual);
}

function isRequestSmallEnough(request: IncomingMessage): boolean {
  const header = request.headers["content-length"];
  if (header === undefined) return true;
  const length = Number(header);
  return (
    Number.isSafeInteger(length) && length >= 0 && length <= MAX_REQUEST_BYTES
  );
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function respond(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}
