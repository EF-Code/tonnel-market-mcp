import type { SqliteDatabase } from "./database.js";

export type CoverageKind = "available" | "gap";

export type CoverageInterval = {
  id: number;
  kind: CoverageKind;
  from?: string;
  to?: string;
  reason: string;
  source: string;
  createdAt: string;
};

type CoverageRow = {
  id: number;
  kind: CoverageKind;
  from_at: string | null;
  to_at: string | null;
  reason: string;
  source: string;
  created_at: string;
};

export class CoverageRepository {
  constructor(private readonly db: SqliteDatabase) {}

  record(
    kind: CoverageKind,
    interval: { from?: string; to?: string },
    reason: string,
    source: string,
    createdAt = new Date().toISOString(),
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO coverage_intervals (kind, from_at, to_at, reason, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        kind,
        interval.from ?? null,
        interval.to ?? null,
        reason,
        source,
        createdAt,
      );
    return Number(result.lastInsertRowid);
  }

  list(): CoverageInterval[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, from_at, to_at, reason, source, created_at
         FROM coverage_intervals ORDER BY COALESCE(from_at, ''), id`,
      )
      .all() as CoverageRow[];
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      ...(row.from_at ? { from: row.from_at } : {}),
      ...(row.to_at ? { to: row.to_at } : {}),
      reason: row.reason,
      source: row.source,
      createdAt: row.created_at,
    }));
  }

  gaps(): CoverageInterval[] {
    return this.list().filter((interval) => interval.kind === "gap");
  }
}
