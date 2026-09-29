export const tenantCrmAutomationTriggers = [
  "ORDER_DELIVERED", "FEEDBACK_CREATED", "FEEDBACK_RESOLVED", "CLIENT_LAPSED", "CLIENT_BIRTHDAY",
] as const;
export type TenantCrmAutomationTrigger = (typeof tenantCrmAutomationTriggers)[number];

export const tenantCrmAutomationActions = ["ADD_TAG", "REMOVE_TAG", "CREATE_REMINDER", "ADD_NOTE"] as const;
export type TenantCrmAutomationAction = (typeof tenantCrmAutomationActions)[number];

export const AUTOMATION_MAX_ATTEMPTS = 3;
export const AUTOMATION_MAX_DEPTH = 5;
export const AUTOMATION_STALE_MS = 5 * 60_000;
export const AUTOMATION_RETRY_DELAY_MS = [2_000, 10_000] as const;

export class TenantCrmAutomationError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) {
    super(message);
  }
}

export function automationError(error: unknown, fallback: string) {
  if (error instanceof TenantCrmAutomationError)
    return { code: error.code, message: error.message, retryable: error.retryable };
  const driver = error as { driverError?: { code?: string }; code?: string } | null;
  const code = driver?.driverError?.code ?? driver?.code;
  if (code === "40001" || code === "40P01" || code === "55P03" || (typeof code === "string" && code.startsWith("08")))
    return { code: "TEMPORARY_DATABASE_ERROR", message: "A temporary database error occurred.", retryable: true };
  return { code: "AUTOMATION_PROCESSING_FAILED", message: fallback, retryable: false };
}

export function automationRetryDelay(attempt: number) {
  return AUTOMATION_RETRY_DELAY_MS[Math.min(Math.max(attempt - 1, 0), AUTOMATION_RETRY_DELAY_MS.length - 1)]!;
}
