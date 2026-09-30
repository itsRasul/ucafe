import { Logger } from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import { getRequestObservabilityContext } from "./request-context";
import { sanitizeStructuredAttributes, sanitizeText } from "./sentry-privacy";

export function logOperationalFailure(
  logger: Logger,
  level: "warn" | "error",
  message: string,
  attributes: Record<string, unknown> = {},
): void {
  const context = getRequestObservabilityContext();
  const safeAttributes = sanitizeStructuredAttributes({
    ...(context ? {
      request_id: context.requestId,
      tenant_id: context.tenantId,
      feature: context.feature,
      actor_role: context.actorRole,
    } : {}),
    ...attributes,
  });
  const safeMessage = sanitizeText(message);
  const record = JSON.stringify({ level, message: safeMessage, ...safeAttributes });

  if (level === "warn") logger.warn(record);
  else logger.error(record);

  try {
    Sentry.logger[level](safeMessage, safeAttributes);
  } catch {
    // Observability must not change the application operation.
  }
}
