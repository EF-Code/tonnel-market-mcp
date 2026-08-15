import type { SqliteDatabase } from "./database.js";
import { AppError } from "../domain/errors.js";
import {
  validateAlertRule,
  type AlertRule,
  type AlertRuleInput,
} from "../alerts/rules.js";

type RuleRow = {
  id: number;
  name: string;
  enabled: number;
  rule_json: string;
  created_at: string;
  updated_at: string;
};

export type AlertHit = {
  id: number;
  ruleId: number;
  eventId?: string;
  matchedAt: string;
  payload: Record<string, unknown>;
};

export class AlertRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: AlertRuleInput, now = new Date().toISOString()): AlertRule {
    const rule = validateAlertRule(input);
    try {
      const result = this.db
        .prepare(
          `INSERT INTO alert_rules (name, enabled, rule_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(rule.name, rule.enabled ? 1 : 0, JSON.stringify(rule), now, now);
      return this.get(Number(result.lastInsertRowid));
    } catch (error) {
      throw new AppError(
        "INVALID_ARGUMENT",
        "An alert with this name may already exist.",
        {
          cause: error,
        },
      );
    }
  }

  list(): AlertRule[] {
    return (
      this.db
        .prepare("SELECT * FROM alert_rules ORDER BY id ASC")
        .all() as RuleRow[]
    ).map(toRule);
  }

  get(id: number): AlertRule {
    const row = this.db
      .prepare("SELECT * FROM alert_rules WHERE id = ?")
      .get(id) as RuleRow | undefined;
    if (!row)
      throw new AppError("ALERT_NOT_FOUND", "Alert rule was not found.");
    return toRule(row);
  }

  getByName(name: string): AlertRule {
    const row = this.db
      .prepare("SELECT * FROM alert_rules WHERE name = ?")
      .get(name) as RuleRow | undefined;
    if (!row)
      throw new AppError("ALERT_NOT_FOUND", "Alert rule was not found.");
    return toRule(row);
  }

  delete(id: number): void {
    const result = this.db
      .prepare("DELETE FROM alert_rules WHERE id = ?")
      .run(id);
    if (result.changes === 0)
      throw new AppError("ALERT_NOT_FOUND", "Alert rule was not found.");
  }

  recordHit(
    ruleId: number,
    eventId: string | undefined,
    payload: Record<string, unknown>,
    matchedAt = new Date().toISOString(),
  ): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO alert_hits (rule_id, event_id, matched_at, payload_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(ruleId, eventId ?? null, matchedAt, JSON.stringify(payload));
    return result.changes > 0;
  }

  listHits(ruleId: number, limit = 100): AlertHit[] {
    const rows = this.db
      .prepare(
        `SELECT id, rule_id, event_id, matched_at, payload_json
         FROM alert_hits WHERE rule_id = ? ORDER BY matched_at DESC, id DESC LIMIT ?`,
      )
      .all(ruleId, Math.min(500, Math.max(1, limit))) as Array<{
      id: number;
      rule_id: number;
      event_id: string | null;
      matched_at: string;
      payload_json: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      ruleId: row.rule_id,
      ...(row.event_id ? { eventId: row.event_id } : {}),
      matchedAt: row.matched_at,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    }));
  }
}

function toRule(row: RuleRow): AlertRule {
  const parsed = JSON.parse(row.rule_json) as Omit<
    AlertRule,
    "id" | "createdAt" | "updatedAt"
  >;
  return {
    ...parsed,
    id: row.id,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
