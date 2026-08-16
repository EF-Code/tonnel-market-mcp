import type { McpServer } from "@modelcontextprotocol/server";

import { MarketAnalytics } from "../../analytics/summaries.js";
import type { RuntimeServices } from "../../runtime.js";
import { estimateLagSeconds } from "../../observability/health.js";
import {
  marketAuctionStatusSchema,
  marketFindOpportunitiesSchema,
  marketGiftHistorySchema,
  marketHealthSchema,
  marketRecentListingsSchema,
  marketSalesSummarySchema,
  marketSearchSchema,
} from "../schemas.js";
import { marketResult, toolFailure, toolSuccess } from "../result-envelope.js";
import type { SearchOptions } from "../../storage/query-repository.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerMarketTools(
  server: McpServer,
  services: RuntimeServices,
): void {
  const analytics = new MarketAnalytics(services.query, services.coverage);

  server.registerTool(
    "market_recent_listings",
    {
      title: "Read recent listing observations",
      description:
        "Find recent listing.created and listing.price_changed observations in a UTC window. The tool waits for the replay-first local collector up to waitSeconds and reports ready=false when an empty result is provisional.",
      inputSchema: marketRecentListingsSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const to = input.to ?? new Date().toISOString();
        const from = new Date(
          Date.parse(to) - input.minutes * 60 * 1_000,
        ).toISOString();
        const wait = await services.coverage.waitForWindow(
          { from, to },
          input.waitSeconds * 1_000,
        );
        const result = analytics.search(
          stripUndefined({
            giftId: input.giftId,
            giftNum: input.giftNum,
            giftName: input.giftName,
            model: input.model,
            backdrop: input.backdrop,
            symbol: input.symbol,
            asset: input.asset,
            saleType: input.saleType,
            source: input.source,
            eventTypes: input.eventTypes,
            from,
            to,
            sort: "occurred_desc",
            limit: input.limit,
          }) as SearchOptions,
        );
        const ready =
          wait.ready && result.coverage.requestedWindowCovered === true;
        return toolSuccess(
          marketResult({
            data: {
              from,
              to,
              minutes: input.minutes,
              ready,
              waitedMs: wait.waitedMs,
              observations: result.data.observations,
            },
            coverage: result.coverage,
            canonicalEventTypes: result.canonicalEventTypes,
            eventIds: result.eventIds,
            warnings: [
              ...result.warnings,
              ...(ready
                ? []
                : [
                    `The requested window was not fully covered within ${input.waitSeconds} seconds; an empty result is provisional.`,
                  ]),
            ],
            nextCursor: result.nextCursor,
          }),
        );
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "market_search",
    {
      title: "Search observed marketplace events",
      description:
        "Search bounded local observations from the read-only Tonnel event ledger; results include provenance and coverage limits.",
      inputSchema: marketSearchSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const result = analytics.search(stripUndefined(input) as SearchOptions);
        return toolSuccess(marketResult(result));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "market_gift_history",
    {
      title: "Read gift event history",
      description:
        "Return a chronological observed timeline for one public gift without inferring any person or owner identity.",
      inputSchema: marketGiftHistorySchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const result = analytics.history(
          stripUndefined(input) as Parameters<MarketAnalytics["history"]>[0],
        );
        return toolSuccess(marketResult(result));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "market_sales_summary",
    {
      title: "Summarize canonical sales",
      description:
        "Summarize sale.completed observations with exact asset separation and deterministic sample statistics.",
      inputSchema: marketSalesSummarySchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const result = analytics.salesSummary(
          stripUndefined(input) as Parameters<
            MarketAnalytics["salesSummary"]
          >[0],
        );
        return toolSuccess(marketResult(result));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "market_auction_status",
    {
      title: "Inspect observed auction status",
      description:
        "Inspect auction lifecycle and bid observations; bid counts are not unique bidder counts and sales remain canonicalized separately.",
      inputSchema: marketAuctionStatusSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const result = analytics.auctionStatus(
          stripUndefined(input) as Parameters<
            MarketAnalytics["auctionStatus"]
          >[0],
        );
        return toolSuccess(marketResult(result));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "market_find_opportunities",
    {
      title: "Screen observed market patterns",
      description:
        "Run a deterministic, evidence-bounded opportunity screen; this never recommends or executes a transaction.",
      inputSchema: marketFindOpportunitiesSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const result = analytics.findOpportunities(
          stripUndefined(input) as Parameters<
            MarketAnalytics["findOpportunities"]
          >[0],
        );
        return toolSuccess(marketResult(result));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "market_health",
    {
      title: "Read collector health",
      description:
        "Report collector, replay, checkpoint, lag, duplicate, unknown-event, error, coverage, and migration state without secrets or paths.",
      inputSchema: marketHealthSchema,
      annotations: readOnlyAnnotations,
    },
    async () => {
      try {
        const state = services.events.getHealthState();
        const coverage = services.coverage.get();
        const lagSeconds = estimateLagSeconds(state.lastReceivedAt);
        const result = marketResult({
          data: {
            collector: state,
            websocket: { state: state.websocketState },
            lastUpstreamServerTime: state.lastServerTime,
            lastReceivedAt: state.lastReceivedAt,
            lastCommittedAt: state.lastCommittedAt,
            lastCommittedEventId: state.lastCommittedEventId,
            replay: {
              state: state.replayState,
              lastSuccessfulReplay: state.lastReplayCompletedAt,
              cursorExpiryCount: state.cursorExpiryCount,
            },
            lagSeconds,
            duplicateCount: state.duplicateCount,
            unknownEventTypeCount: state.unknownEventCount,
            processingErrorCount: state.processingErrorCount,
            coverageGapCount: coverage.gaps.length,
            migrationVersion: services.coverage.migrationVersion(),
          },
          coverage,
          canonicalEventTypes: [],
          warnings: services.coverage.warnings(coverage),
        });
        return toolSuccess(result);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );
}

function stripUndefined<T extends Record<string, unknown>>(
  value: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}
