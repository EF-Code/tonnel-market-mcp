import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import { AppError } from "../domain/errors.js";
import { migration as initialMigration } from "./migrations/001_initial.js";

export type SqliteDatabase = Database.Database;

const MIGRATIONS = [initialMigration] as const;

export class DatabaseManager {
  readonly db: SqliteDatabase;
  readonly path: string;

  constructor(path: string, options: { readonly inMemory?: boolean } = {}) {
    this.path = options.inMemory ? ":memory:" : path;
    if (!options.inMemory) mkdirSync(dirname(path), { recursive: true });

    try {
      this.db = new Database(this.path);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
      this.db.pragma("busy_timeout = 5000");
      this.db.pragma("synchronous = NORMAL");
    } catch (error) {
      throw new AppError(
        "DATABASE_UNAVAILABLE",
        "Unable to open the marketplace database.",
        {
          cause: error,
        },
      );
    }
  }

  migrate(): number {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = new Set(
      this.db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all()
        .map((row) => Number((row as { version: number }).version)),
    );

    const apply = this.db.transaction(() => {
      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        this.db.exec(migration.sql);
        this.db
          .prepare(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
          )
          .run(migration.version, migration.name, new Date().toISOString());
      }
    });

    try {
      apply();
    } catch (error) {
      throw new AppError("MIGRATION_REQUIRED", "Database migration failed.", {
        cause: error,
      });
    }
    return this.currentMigrationVersion();
  }

  currentMigrationVersion(): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
      )
      .get() as { version: number } | undefined;
    return Number(row?.version ?? 0);
  }

  transaction<T>(callback: () => T): T {
    try {
      return this.db.transaction(callback)();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "DATABASE_UNAVAILABLE",
        "A database transaction failed.",
        { cause: error },
      );
    }
  }

  close(): void {
    if (this.db.open) this.db.close();
  }
}
