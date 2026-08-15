import type { LogLevel } from "../config.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export type Logger = {
  error(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
};

function safeFields(fields: Record<string, unknown> | undefined): string {
  if (!fields) return "";
  const safe = Object.fromEntries(
    Object.entries(fields).filter(
      ([key]) => !/(token|secret|password|authorization|cookie)/iu.test(key),
    ),
  );
  return Object.keys(safe).length > 0 ? ` ${JSON.stringify(safe)}` : "";
}

export function createLogger(level: LogLevel): Logger {
  const write = (
    entryLevel: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ) => {
    if (LEVEL_ORDER[entryLevel] > LEVEL_ORDER[level]) return;
    const line = `${new Date().toISOString()} ${entryLevel.toUpperCase()} ${message}${safeFields(fields)}`;
    console.error(line);
  };
  return {
    error: (message, fields) => write("error", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    info: (message, fields) => write("info", message, fields),
    debug: (message, fields) => write("debug", message, fields),
  };
}
