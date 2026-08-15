import { randomUUID } from "node:crypto";

import type { CallToolResult } from "@modelcontextprotocol/server";

import { isAppError, toSafeError } from "../domain/errors.js";
import type { CoverageEnvelope } from "../analytics/coverage.js";

export type MarketToolResult<T> = {
  data: T;
  coverage: CoverageEnvelope;
  provenance: {
    source: "Tonnel Marketplace Event API";
    canonicalEventTypes: string[];
    eventIds?: string[];
    generatedAt: string;
  };
  warnings: string[];
  pagination?: {
    nextCursor: string | null;
  };
};

export function marketResult<T>(options: {
  data: T;
  coverage: CoverageEnvelope;
  canonicalEventTypes: string[];
  warnings?: string[];
  eventIds?: string[];
  nextCursor?: string | null;
}): MarketToolResult<T> {
  return {
    data: options.data,
    coverage: options.coverage,
    provenance: {
      source: "Tonnel Marketplace Event API",
      canonicalEventTypes: [...new Set(options.canonicalEventTypes)].sort(),
      ...(options.eventIds && options.eventIds.length > 0
        ? { eventIds: options.eventIds }
        : {}),
      generatedAt: new Date().toISOString(),
    },
    warnings: options.warnings ?? [],
    ...(options.nextCursor !== undefined
      ? { pagination: { nextCursor: options.nextCursor } }
      : {}),
  };
}

export function toolSuccess<T>(result: MarketToolResult<T>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}

export function toolFailure(error: unknown): CallToolResult {
  const correlationId = randomUUID();
  const safe = toSafeError(error, correlationId);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: safe }) }],
    structuredContent: { error: safe },
  };
}

export function isExpectedToolError(error: unknown): boolean {
  return isAppError(error);
}
