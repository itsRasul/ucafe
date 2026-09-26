import { CrmActivityType, CrmCallOutcome, CrmMeetingOutcome } from "./entities/crm-activity.entity";
import { CrmTaskStatus } from "./entities/crm-task.entity";

export function isValidCrmActivityOutcome(type: CrmActivityType, outcome: string | null | undefined): boolean {
  if (!outcome) return true;
  if (type === CrmActivityType.Call) return Object.values(CrmCallOutcome).includes(outcome as CrmCallOutcome);
  if (type === CrmActivityType.Meeting || type === CrmActivityType.Demo) return Object.values(CrmMeetingOutcome).includes(outcome as CrmMeetingOutcome);
  return false;
}

export function isCrmTaskOverdue(status: CrmTaskStatus, dueAt: Date | string | null, now = new Date()): boolean {
  return status === CrmTaskStatus.Open && dueAt !== null && new Date(dueAt).getTime() < now.getTime();
}
