import type { AnyMarketplaceEvent } from "../domain/events.js";
import { AlertRepository } from "../storage/alert-repository.js";
import type { SqliteDatabase } from "../storage/database.js";
import { matchesAlert } from "./rules.js";
import type { AlertNotifier } from "./notifiers.js";

export class AlertEngine {
  constructor(
    private readonly repository: AlertRepository,
    private readonly notifier?: AlertNotifier,
  ) {}

  evaluate(
    db: SqliteDatabase,
    event: AnyMarketplaceEvent,
    now = new Date().toISOString(),
  ): number {
    let hits = 0;
    for (const rule of this.repository.list()) {
      if (!matchesAlert(rule, event, now)) continue;
      const inserted = this.repository.recordHit(
        rule.id,
        event.eventId,
        {
          eventId: event.eventId,
          eventType: event.type,
          occurredAt: event.occurredAt,
          data: event.data,
        },
        now,
      );
      if (!inserted) continue;
      hits += 1;
      if (this.notifier) {
        void this.notifier
          .notify({
            ruleId: rule.id,
            ruleName: rule.name,
            eventId: event.eventId,
            eventType: event.type,
            occurredAt: event.occurredAt,
            payload: event.data,
          })
          .catch(() => {
            // Alert persistence remains durable even when a notifier is unavailable.
          });
      }
    }
    void db;
    return hits;
  }
}
