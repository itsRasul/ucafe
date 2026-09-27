export const CRM_WORKFLOW_TRIGGERS = [
  "LEAD_CREATED",
  "LEAD_QUALIFIED",
  "LEAD_CONVERTED",
  "LEAD_STATUS_CHANGED",
  "DEAL_CREATED",
  "DEAL_STAGE_CHANGED",
  "DEAL_WON",
  "DEAL_LOST",
  "ACTIVITY_CREATED",
  "TASK_COMPLETED",
  "LEAD_SCORE_CHANGED",
  "LEAD_SCORE_CROSSED_THRESHOLD",
  "TASK_OVERDUE",
  "TRIAL_ENDING",
] as const;

export type CrmWorkflowTrigger = typeof CRM_WORKFLOW_TRIGGERS[number];
export type CrmWorkflowRecordType = "ORGANIZATION" | "LEAD" | "DEAL";
export type CrmWorkflowActionType = "CREATE_TASK" | "ADD_TAG" | "REMOVE_TAG" | "ASSIGN_LEAD_OWNER" | "ASSIGN_DEAL_OWNER";

export const CRM_WORKFLOW_ACTIONS: readonly CrmWorkflowActionType[] = ["CREATE_TASK", "ADD_TAG", "REMOVE_TAG", "ASSIGN_LEAD_OWNER", "ASSIGN_DEAL_OWNER"];
export const CRM_WORKFLOW_MAX_DEPTH = 5;
export const CRM_WORKFLOW_MAX_ACTIONS = 10;
export const CRM_WORKFLOW_MAX_ENABLED = 100;
export const CRM_WORKFLOW_MAX_ATTEMPTS = 3;

export type CrmWorkflowEventType = Exclude<CrmWorkflowTrigger, "LEAD_SCORE_CROSSED_THRESHOLD">;
export type WorkflowEventContext = Record<string, unknown>;

export function eventTypesForTrigger(trigger: CrmWorkflowTrigger): CrmWorkflowEventType[] {
  return trigger === "LEAD_SCORE_CROSSED_THRESHOLD" ? ["LEAD_SCORE_CHANGED"] : [trigger];
}

export function triggerMatches(trigger: CrmWorkflowTrigger, config: Record<string, unknown>, eventType: CrmWorkflowEventType, context: WorkflowEventContext): boolean {
  if (!eventTypesForTrigger(trigger).includes(eventType)) return false;
  if (trigger === "LEAD_STATUS_CHANGED") return (!config.fromStatus || config.fromStatus === context.fromStatus) && (!config.toStatus || config.toStatus === context.toStatus);
  if (trigger === "DEAL_STAGE_CHANGED") return (!config.fromStage || config.fromStage === context.fromStage) && (!config.toStage || config.toStage === context.toStage);
  if (trigger === "LEAD_SCORE_CROSSED_THRESHOLD") {
    if (context.previousOverallScore == null) return false;
    const previous = Number(context.previousOverallScore);
    const current = Number(context.overallScore);
    const threshold = Number(config.threshold);
    if (!Number.isFinite(previous) || !Number.isFinite(current) || !Number.isInteger(threshold)) return false;
    return config.direction === "BELOW" ? previous >= threshold && current < threshold : previous < threshold && current >= threshold;
  }
  return true;
}

export function workflowLoopBlocked(depth: number): boolean {
  return depth >= CRM_WORKFLOW_MAX_DEPTH;
}

export function workflowRetryDelayMs(attempt: number): number {
  return attempt <= 1 ? 2_000 : 10_000;
}

export function isTransientWorkflowError(error: unknown): boolean {
  const driver = error && typeof error === "object" && "driverError" in error ? (error as { driverError?: unknown }).driverError : error;
  const code = driver && typeof driver === "object" && "code" in driver ? String((driver as { code: unknown }).code) : "";
  return /^(08|40|53|55|57|58|HYT00|ECONNRESET|ETIMEDOUT)/.test(code);
}

export function workflowSafeError(error: unknown): { code: string; message: string } {
  if (isTransientWorkflowError(error)) return { code: "TEMPORARY_DATABASE_ERROR", message: "Temporary database error. The action will be retried." };
  return { code: "ACTION_REJECTED", message: "The action could not be completed. Check that its CRM record, tag, and assignee are still active." };
}
