import assert from "node:assert/strict";
import test from "node:test";

import type { RawData } from "ws";

import { MarketplaceCollector } from "../../src/ingest/collector.js";
import { CursorExpiredError, ReplayClient } from "../../src/ingest/replay.js";
import { CoverageRepository } from "../../src/storage/coverage-repository.js";
import { DatabaseManager } from "../../src/storage/database.js";
import { EventRepository } from "../../src/storage/event-repository.js";
import { ProjectionRepository } from "../../src/storage/projection-repository.js";
import { fixtureEvent } from "../fixtures/events.js";

class FakeSocket {
  private readonly listeners: {
    open?: () => void;
    message?: (data: RawData) => void;
    close?: (code: number, reason: Buffer) => void;
    error?: (error: Error) => void;
  } = {};

  on(
    event: "open" | "message" | "close" | "error",
    listener: (...args: never[]) => void,
  ): this {
    if (event === "open") this.listeners.open = listener as () => void;
    if (event === "message")
      this.listeners.message = listener as (data: RawData) => void;
    if (event === "close")
      this.listeners.close = listener as (code: number, reason: Buffer) => void;
    if (event === "error")
      this.listeners.error = listener as (error: Error) => void;
    return this;
  }

  emitOpen(): void {
    this.listeners.open?.();
  }

  emitMessage(message: unknown): void {
    this.listeners.message?.(Buffer.from(JSON.stringify(message)));
  }

  close(code = 1000, reason = "closed"): void {
    this.listeners.close?.(code, Buffer.from(reason));
  }
}

const silentLogger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

test("replay client paginates and does not advance a cursor before page handling succeeds", async () => {
  const requests: string[] = [];
  const pages = [
    {
      status: "success",
      events: [
        fixtureEvent("listing.created", 1),
        fixtureEvent("listing.price_changed", 2),
      ],
      nextAfter: "cursor-1",
    },
    {
      status: "success",
      events: [fixtureEvent("sale.completed", 3)],
      nextAfter: null,
    },
  ];
  const client = new ReplayClient({
    endpoint: "https://example.test/api/marketplace/events",
    limit: 2,
    fetch: async (input) => {
      const url = new URL(input);
      requests.push(url.search);
      const page = pages[requests.length - 1];
      assert.ok(page);
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const seen: string[] = [];
  const result = await client.replayAll(undefined, (page, cursorUsed) => {
    seen.push(`${cursorUsed ?? "start"}:${page.events.length}`);
  });

  assert.deepEqual(seen, ["start:2", "cursor-1:1"]);
  assert.equal(result.pages, 2);
  assert.equal(result.events, 3);
  assert.deepEqual(requests, ["?limit=2", "?limit=2&after=cursor-1"]);
});

test("replay client exposes cursor expiry as a typed recoverable boundary", async () => {
  const client = new ReplayClient({
    endpoint: "https://example.test/api/marketplace/events",
    fetch: async () =>
      new Response("invalid or expired after cursor", {
        status: 400,
      }),
  });

  await assert.rejects(
    () => client.fetchPage({ after: "expired-cursor" }),
    (error: unknown) =>
      error instanceof CursorExpiredError &&
      error.code === "CURSOR_EXPIRED" &&
      error.details?.after === "expired-cursor",
  );
});

test("collector buffers live events until replay recovery and then commits both paths", async () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const events = new EventRepository(database);
  const projections = new ProjectionRepository();
  const coverage = new CoverageRepository(database.db);
  const socket = new FakeSocket();
  const replayEvent = fixtureEvent("listing.created", 10);
  const liveEvent = fixtureEvent("listing.price_changed", 9);
  const replay = new ReplayClient({
    endpoint: "https://example.test/api/marketplace/events",
    limit: 50,
    fetch: async () => {
      socket.emitMessage(liveEvent);
      return new Response(
        JSON.stringify({
          status: "success",
          events: [replayEvent],
          nextAfter: null,
        }),
        { status: 200 },
      );
    },
  });
  const collector = new MarketplaceCollector({
    config: { websocketUrl: "wss://example.test/ws" },
    events,
    projections,
    coverage,
    replay,
    logger: silentLogger,
    now: () => "2026-08-15T02:00:00.000Z",
    websocketFactory: () => socket,
    sleep: async () => undefined,
  });
  const abort = new AbortController();
  const running = collector.run(abort.signal);

  socket.emitOpen();
  await new Promise((resolve) => setTimeout(resolve, 25));
  abort.abort();
  await running;

  const rawCount = (
    database.db.prepare("SELECT COUNT(*) AS count FROM raw_events").get() as {
      count: number;
    }
  ).count;
  assert.equal(rawCount, 2);
  assert.equal(events.getCheckpoint()?.eventId, liveEvent.eventId);
  assert.equal(events.getHealthState().replayState, "completed");
  assert.equal(events.getHealthState().websocketState, "stopped");
  database.close();
});

test("expired replay cursors record a coverage gap before restarting from the retention window", async () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const events = new EventRepository(database);
  const projections = new ProjectionRepository();
  const coverage = new CoverageRepository(database.db);
  const socket = new FakeSocket();
  const checkpointEvent = fixtureEvent("listing.created", 20);
  const recoveredEvent = fixtureEvent("listing.price_changed", 21);
  events.initializeCollector("2026-08-15T00:00:00.000Z");
  events.processEvent(
    checkpointEvent,
    {
      source: "replay",
      receivedAt: "2026-08-15T02:00:00.000Z",
      receiveSequence: 1,
      correlationId: "checkpoint",
    },
    (db) => projections.apply(db, checkpointEvent),
  );
  let requestCount = 0;
  const replay = new ReplayClient({
    endpoint: "https://example.test/api/marketplace/events",
    fetch: async (input) => {
      requestCount += 1;
      const url = new URL(input);
      if (url.searchParams.has("after")) {
        return new Response("Invalid or expired after cursor", { status: 400 });
      }
      return new Response(
        JSON.stringify({
          status: "success",
          events: [recoveredEvent],
          nextAfter: null,
        }),
        { status: 200 },
      );
    },
  });
  const collector = new MarketplaceCollector({
    config: { websocketUrl: "wss://example.test/ws" },
    events,
    projections,
    coverage,
    replay,
    logger: silentLogger,
    now: () => "2026-08-15T03:00:00.000Z",
    websocketFactory: () => socket,
    sleep: async () => undefined,
  });
  const abort = new AbortController();
  const running = collector.run(abort.signal);
  socket.emitOpen();
  await new Promise((resolve) => setTimeout(resolve, 25));
  abort.abort();
  await running;

  assert.equal(requestCount, 2);
  assert.equal(events.getHealthState().cursorExpiryCount, 1);
  assert.equal(events.getHealthState().replayState, "completed");
  assert.equal(coverage.gaps().length, 1);
  assert.match(coverage.gaps()[0]?.reason ?? "", /cursor expired/u);
  database.close();
});

test("collector reconnects after the upstream 1013 slow-client close", async () => {
  const database = new DatabaseManager(":memory:", { inMemory: true });
  database.migrate();
  const events = new EventRepository(database);
  const projections = new ProjectionRepository();
  const coverage = new CoverageRepository(database.db);
  const sockets: FakeSocket[] = [];
  const replay = new ReplayClient({
    endpoint: "https://example.test/api/marketplace/events",
    fetch: async () =>
      new Response(
        JSON.stringify({ status: "success", events: [], nextAfter: null }),
        {
          status: 200,
        },
      ),
  });
  const collector = new MarketplaceCollector({
    config: { websocketUrl: "wss://example.test/ws" },
    events,
    projections,
    coverage,
    replay,
    logger: silentLogger,
    now: () => "2026-08-15T04:00:00.000Z",
    websocketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    sleep: async () => undefined,
  });
  const abort = new AbortController();
  const running = collector.run(abort.signal);
  await waitFor(() => sockets.length === 1);
  sockets[0]?.emitOpen();
  await waitFor(() => Boolean(events.getHealthState().lastReplayCompletedAt));
  sockets[0]?.close(1013, "slow consumer");
  await waitFor(() => sockets.length === 2);
  sockets[1]?.emitOpen();
  await waitFor(() => events.getHealthState().websocketState === "connected");
  abort.abort();
  await running;

  assert.equal(sockets.length, 2);
  assert.equal(events.getHealthState().websocketState, "stopped");
  database.close();
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("condition was not reached before timeout");
}
