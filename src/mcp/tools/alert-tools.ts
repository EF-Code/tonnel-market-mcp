import type { McpServer } from "@modelcontextprotocol/server";

import { matchesAlert } from "../../alerts/rules.js";
import type { AlertRuleInput } from "../../alerts/rules.js";
import { parseMarketplaceEvent } from "../../domain/schemas.js";
import type { RuntimeServices } from "../../runtime.js";
import {
  marketCreateAlertSchema,
  marketDeleteAlertSchema,
  marketListAlertsSchema,
  marketTestAlertSchema,
} from "../schemas.js";
import { toolFailure } from "../result-envelope.js";

const localReadAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const localMutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export function registerAlertTools(
  server: McpServer,
  services: RuntimeServices,
): void {
  server.registerTool(
    "market_create_alert",
    {
      title: "Create a local market alert",
      description:
        "Create a durable local-only alert rule; it cannot buy, bid, sell, transfer, or settle anything.",
      inputSchema: marketCreateAlertSchema,
      annotations: localMutationAnnotations,
    },
    async (input) => {
      try {
        const alert = services.alerts.create(
          stripUndefined(input) as AlertRuleInput,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                data: alert,
                warnings: ["This rule is local configuration only."],
              }),
            },
          ],
          structuredContent: {
            data: alert,
            warnings: ["This rule is local configuration only."],
          },
        };
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "market_list_alerts",
    {
      title: "List local market alerts",
      description:
        "List local alert configuration and optionally bounded durable match history.",
      inputSchema: marketListAlertsSchema,
      annotations: localReadAnnotations,
    },
    async (input) => {
      try {
        const alerts = services.alerts.list().map((alert) => ({
          ...alert,
          ...(input.includeHits
            ? { hits: services.alerts.listHits(alert.id, input.limit) }
            : {}),
        }));
        const result = {
          data: { alerts },
          warnings: [
            "Alert rules and hits are local configuration and do not expose user identity.",
          ],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "market_delete_alert",
    {
      title: "Delete a local market alert",
      description:
        "Explicitly delete one local alert rule and its durable local hits.",
      inputSchema: marketDeleteAlertSchema,
      annotations: localMutationAnnotations,
    },
    async ({ alertId }) => {
      try {
        services.alerts.delete(alertId);
        const result = {
          data: { deleted: true, alertId },
          warnings: ["Only local alert configuration was changed."],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    "market_test_alert",
    {
      title: "Test a local market alert",
      description:
        "Evaluate a local alert rule against one supplied event fixture without persisting a hit or contacting an external notifier.",
      inputSchema: marketTestAlertSchema,
      annotations: localReadAnnotations,
    },
    async ({ alertId, sampleEvent }) => {
      try {
        const alert = services.alerts.get(alertId);
        const event = parseMarketplaceEvent(sampleEvent);
        const matched = matchesAlert(alert, event);
        const result = {
          data: {
            alertId,
            matched,
            eventId: event.eventId,
            eventType: event.type,
          },
          warnings: ["Test evaluation does not create a durable alert hit."],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
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
