import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";

import { MarketAnalytics } from "../../analytics/summaries.js";
import { EVENT_TYPES } from "../../domain/events.js";
import type { RuntimeServices } from "../../runtime.js";
import { marketResult } from "../result-envelope.js";

export function registerMarketResources(
  server: McpServer,
  services: RuntimeServices,
): void {
  const analytics = new MarketAnalytics(services.query, services.coverage);

  server.registerResource(
    "market_coverage",
    "market://coverage",
    {
      title: "Marketplace coverage state",
      description:
        "Collector start, replay availability, gaps, checkpoint, and snapshot limitations.",
      mimeType: "application/json",
    },
    async (uri) => {
      const coverage = services.coverage.get();
      return resource(
        uri.href,
        marketResult({
          data: coverage,
          coverage,
          canonicalEventTypes: [],
          warnings: services.coverage.warnings(coverage),
        }),
      );
    },
  );

  server.registerResource(
    "market_event_schema",
    "market://schema/events",
    {
      title: "Marketplace event schema",
      description: "Known event catalog and privacy/read-only contract.",
      mimeType: "application/json",
    },
    async (uri) =>
      resource(uri.href, {
        eventTypes: EVENT_TYPES,
        envelope: {
          eventId: "string",
          version: 1,
          type: "known or forward-compatible unknown string",
          occurredAt: "ISO 8601 UTC",
          data: "event-specific object; unknown fields preserved",
        },
        privacy:
          "No user IDs, names, usernames, wallet addresses, or identity fields are available or inferred.",
        canonicalSales: "sale.completed only",
        mutationBoundary:
          "No marketplace mutation, wallet, signing, transfer, bid, buy, sell, or settlement capability.",
      }),
  );

  server.registerResource(
    "market_stats_24h",
    "market://stats/24h",
    {
      title: "Observed 24-hour market statistics",
      description: "Bounded local statistics for the previous 24 hours.",
      mimeType: "application/json",
    },
    async (uri) => resource(uri.href, marketResult(analytics.stats24h())),
  );

  const giftTemplate = new ResourceTemplate(
    "market://gift/{gift_id}/timeline",
    { list: undefined },
  );
  server.registerResource(
    "market_gift_timeline",
    giftTemplate,
    {
      title: "Gift event timeline",
      description: "Observed events involving a public gift identifier.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const giftId = parsePositiveInteger(variables.gift_id);
      const result = analytics.history({ giftId, limit: 500 });
      return resource(uri.href, marketResult(result));
    },
  );

  const auctionTemplate = new ResourceTemplate(
    "market://auction/{auction_id}",
    { list: undefined },
  );
  server.registerResource(
    "market_auction",
    auctionTemplate,
    {
      title: "Auction observation",
      description: "Observed auction lifecycle and bid facts.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const auctionId = variableString(variables.auction_id);
      const result = analytics.auctionStatus({ auctionId, limit: 1 });
      return resource(uri.href, marketResult(result));
    },
  );

  const dailyTemplate = new ResourceTemplate("market://reports/daily/{date}", {
    list: undefined,
  });
  server.registerResource(
    "market_daily_report",
    dailyTemplate,
    {
      title: "Daily observed market report",
      description:
        "Canonical sales summary and coverage for one UTC calendar day.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const date = variableString(variables.date);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date))
        throw new Error("date must be YYYY-MM-DD");
      const from = `${date}T00:00:00.000Z`;
      const to = new Date(
        Date.parse(from) + 24 * 60 * 60 * 1_000 - 1,
      ).toISOString();
      const result = analytics.salesSummary({ from, to });
      return resource(uri.href, marketResult(result));
    },
  );
}

function resource(uri: string, value: unknown) {
  return {
    contents: [
      { uri, mimeType: "application/json", text: JSON.stringify(value) },
    ],
  };
}

function variableString(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (
    Array.isArray(value) &&
    typeof value[0] === "string" &&
    value[0].length > 0
  )
    return value[0];
  throw new Error("resource template variable is required");
}

function parsePositiveInteger(value: unknown): number {
  const parsed = Number(variableString(value));
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error("gift_id must be a positive integer");
  return parsed;
}
