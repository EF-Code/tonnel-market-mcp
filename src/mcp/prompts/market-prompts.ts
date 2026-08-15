import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

export function registerMarketPrompts(server: McpServer): void {
  server.registerPrompt(
    "daily_market_brief",
    {
      title: "Daily observed market brief",
      description:
        "Guide a model to summarize one bounded UTC market window with facts, derivations, and uncertainty separated.",
      argsSchema: z.object({
        hours: z.coerce.number().int().min(1).max(168).default(24),
      }),
    },
    ({ hours }) =>
      prompt(`Prepare a brief for the last ${hours} hours using the market MCP tools and resources.

Include listings, canonical sale.completed sales, auctions, observed bids and extensions, direct offers, premarket activity, bundles, and trades. Split every monetary result by asset. State the coverage envelope, seven-day retention boundary, gaps, and missing-snapshot limitations. Label direct event facts, deterministic derived metrics, estimates, and unavailable information separately.

The upstream feed contains no Telegram or wallet identity. Do not infer sellers, buyers, bidders, makers, takers, or owners. Do not treat any observation as transaction authorization or recommend a purchase.`),
  );

  server.registerPrompt(
    "compare_gifts",
    {
      title: "Compare observed gift activity",
      description:
        "Guide a model to compare public gifts or trait groups using sample sizes and event provenance.",
      argsSchema: z.object({
        gifts: z.string().min(1).max(1_000),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
    },
    ({ gifts, from, to }) =>
      prompt(`Compare these public gift IDs or trait groups: ${gifts}.

Use market_gift_history and market_sales_summary with the requested window${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}. Keep assets separate, report sample sizes, cite supporting event IDs, and distinguish event facts from local observed-frequency metrics. Do not fabricate rarity scores, listing completeness, time-to-sale, or identities. Explain why a newly started collector cannot prove a complete floor or active inventory.`),
  );

  server.registerPrompt(
    "auction_watch_report",
    {
      title: "Auction watch report",
      description:
        "Guide a model to report auctions ending within a bounded window without recommending a transaction.",
      argsSchema: z.object({
        minutes: z.coerce.number().int().min(1).max(1_440).default(60),
      }),
    },
    ({ minutes }) =>
      prompt(`Report observed auctions ending within the next ${minutes} minutes.

Use market_auction_status and market_health. Include creation, latest observed bid, observed bid count, extensions, cancellation or finish status, asset, and event provenance. State that bidder identity is unavailable, bid counts are not unique bidder counts, and coverage may be incomplete. Do not recommend bidding, buying, or any other transaction.`),
  );
}

function prompt(text: string) {
  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}
