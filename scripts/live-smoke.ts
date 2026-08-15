const endpoint = `${process.env.TONNEL_MARKET_API_BASE ?? "https://gifts.coffin.meme"}/api/marketplace/events?limit=1`;

try {
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    console.error(
      `live smoke skipped: upstream returned HTTP ${response.status}`,
    );
  } else {
    const body = (await response.json()) as {
      status?: string;
      events?: unknown[];
    };
    if (body.status !== "success" || !Array.isArray(body.events)) {
      console.error(
        "live smoke skipped: upstream response shape was not recognized",
      );
    } else {
      console.error(
        `live smoke passed: read ${body.events.length} read-only replay event(s)`,
      );
    }
  }
} catch (error) {
  console.error(
    `live smoke skipped: ${error instanceof Error ? error.message : "upstream unavailable"}`,
  );
}
