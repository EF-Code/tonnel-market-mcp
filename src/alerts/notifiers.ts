import type { Logger } from "../observability/logger.js";

export type AlertNotification = {
  ruleId: number;
  ruleName: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export interface AlertNotifier {
  notify(notification: AlertNotification): Promise<void>;
}

export class LogAlertNotifier implements AlertNotifier {
  constructor(private readonly logger: Logger) {}

  async notify(notification: AlertNotification): Promise<void> {
    this.logger.info("local alert matched", {
      ruleId: notification.ruleId,
      eventId: notification.eventId,
      eventType: notification.eventType,
    });
  }
}
