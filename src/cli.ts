#!/usr/bin/env node

import { loadConfig, type McpTransport } from "./config.js";
import { createRuntime } from "./runtime.js";
import { printSetupHelp, runDoctor, runSetup } from "./setup.js";
import { startHttp } from "./transport/http.js";
import { startStdio } from "./transport/stdio.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "setup") {
    await runSetup(process.argv.slice(3));
    return;
  }
  if (command === "doctor") {
    runDoctor();
    return;
  }
  if (command === "--help" || command === "-h") {
    printSetupHelp();
    return;
  }

  const args = new Set(process.argv.slice(2));
  const requestedTransport = getArgumentValue("--transport");
  const env = requestedTransport
    ? { ...process.env, TONNEL_MARKET_MCP_TRANSPORT: requestedTransport }
    : process.env;
  const config = loadConfig(env);

  if (args.has("--migrate-only")) {
    const runtime = createRuntime(config);
    runtime.logger.info("database migrations applied", {
      version: runtime.coverage.migrationVersion(),
    });
    runtime.close();
    return;
  }

  const runtime = createRuntime(config);
  const collectorTask = runtime.collector.run();
  collectorTask.catch((error) => {
    runtime.logger.error("collector stopped unexpectedly", {
      message: error instanceof Error ? error.message : "unknown error",
    });
  });

  let closeTransport: (() => Promise<void>) | undefined;
  if (config.mcpTransport === "http") {
    const server = await startHttp(runtime, config);
    closeTransport = () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  } else {
    const handle = startStdio(runtime);
    closeTransport = () => handle.close();
    runtime.logger.info("MCP stdio server listening");
  }

  const shutdown = async (signal: string) => {
    runtime.logger.info("shutting down", { signal });
    try {
      await closeTransport?.();
    } finally {
      runtime.close();
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

function getArgumentValue(name: string): McpTransport | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value === "stdio" || value === "http" ? value : undefined;
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "unknown startup error";
  console.error(message);
  process.exitCode = 1;
});
