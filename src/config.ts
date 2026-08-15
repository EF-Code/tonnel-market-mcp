import { resolve } from "node:path";

import { AppError } from "./domain/errors.js";

export type LogLevel = "error" | "warn" | "info" | "debug";
export type McpTransport = "stdio" | "http";

export type AppConfig = {
  apiBase: string;
  websocketUrl: string;
  databasePath: string;
  logLevel: LogLevel;
  mcpTransport: McpTransport;
  httpHost: string;
  httpPort: number;
  httpPublic: boolean;
  httpToken?: string;
};

const DEFAULT_API_BASE = "https://gifts.coffin.meme";
const DEFAULT_WEBSOCKET_URL = "wss://gifts.coffin.meme/api/marketplace/ws";

function envValue(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const value = env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function parseUrl(
  value: string,
  name: string,
  protocols: readonly string[],
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new AppError("INVALID_ARGUMENT", `${name} must be a valid URL.`, {
      cause: error,
    });
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new AppError(
      "INVALID_ARGUMENT",
      `${name} must use ${protocols.join(" or ")}.`,
    );
  }
  return parsed.toString().replace(/\/$/u, "");
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "TONNEL_MARKET_HTTP_PORT must be between 1 and 65535.",
    );
  }
  return port;
}

function parseBoolean(value: string, name: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AppError("INVALID_ARGUMENT", `${name} must be true or false.`);
}

function parseLogLevel(value: string): LogLevel {
  if (
    value === "error" ||
    value === "warn" ||
    value === "info" ||
    value === "debug"
  )
    return value;
  throw new AppError(
    "INVALID_ARGUMENT",
    "TONNEL_MARKET_LOG_LEVEL must be error, warn, info, or debug.",
  );
}

function parseTransport(value: string): McpTransport {
  if (value === "stdio" || value === "http") return value;
  throw new AppError(
    "INVALID_ARGUMENT",
    "TONNEL_MARKET_MCP_TRANSPORT must be stdio or http.",
  );
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiBase = parseUrl(
    envValue(env, "TONNEL_MARKET_API_BASE", DEFAULT_API_BASE),
    "TONNEL_MARKET_API_BASE",
    ["https:", "http:"],
  );
  const websocketUrl = parseUrl(
    envValue(env, "TONNEL_MARKET_WS_URL", DEFAULT_WEBSOCKET_URL),
    "TONNEL_MARKET_WS_URL",
    ["wss:", "ws:"],
  );
  const databasePath = resolve(
    envValue(env, "TONNEL_MARKET_DB_PATH", ".data/tonnel-market.sqlite"),
  );
  const logLevel = parseLogLevel(
    envValue(env, "TONNEL_MARKET_LOG_LEVEL", "info"),
  );
  const mcpTransport = parseTransport(
    envValue(env, "TONNEL_MARKET_MCP_TRANSPORT", "stdio"),
  );
  const httpHost = envValue(env, "TONNEL_MARKET_HTTP_HOST", "127.0.0.1");
  const httpPort = parsePort(envValue(env, "TONNEL_MARKET_HTTP_PORT", "8787"));
  const requestedPublic = parseBoolean(
    envValue(env, "TONNEL_MARKET_HTTP_PUBLIC", "false"),
    "TONNEL_MARKET_HTTP_PUBLIC",
  );
  const httpPublic = requestedPublic || !isLoopbackHost(httpHost);
  const tokenValue = env["TONNEL_MARKET_HTTP_TOKEN"]?.trim();

  if (httpPublic && !tokenValue) {
    throw new AppError(
      "INVALID_ARGUMENT",
      "HTTP mode requires TONNEL_MARKET_HTTP_TOKEN when binding outside loopback.",
    );
  }

  return {
    apiBase,
    websocketUrl,
    databasePath,
    logLevel,
    mcpTransport,
    httpHost,
    httpPort,
    httpPublic,
    ...(tokenValue ? { httpToken: tokenValue } : {}),
  };
}

export function replayEndpoint(config: Pick<AppConfig, "apiBase">): string {
  return new URL("/api/marketplace/events", `${config.apiBase}/`).toString();
}
