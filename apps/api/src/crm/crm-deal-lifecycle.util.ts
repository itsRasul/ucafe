import { CRM_DEFAULT_PIPELINE_KEY, CrmDealStage } from "./entities/crm-deal.entity";

export const CRM_DEAL_STAGES: readonly CrmDealStage[] = [
  CrmDealStage.Discovery,
  CrmDealStage.DemoScheduled,
  CrmDealStage.DemoCompleted,
  CrmDealStage.TrialProposed,
  CrmDealStage.TrialActive,
  CrmDealStage.Decision,
];

export const CRM_DEFAULT_PIPELINE = {
  key: CRM_DEFAULT_PIPELINE_KEY,
  name: "UCafe Platform Sales",
  stages: CRM_DEAL_STAGES.map((key, index) => ({ key, position: index + 1 })),
} as const;

export function crmDealStageRequiresReason(from: CrmDealStage, to: CrmDealStage): boolean {
  const previous = CRM_DEAL_STAGES.indexOf(from);
  const next = CRM_DEAL_STAGES.indexOf(to);
  return next <= previous || next > previous + 1;
}

export function isValidCrmDealDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function isValidCrmDealAmount(value: string): boolean {
  if (!/^(0|[1-9]\d*)$/.test(value)) return false;
  try { return BigInt(value) <= 9_223_372_036_854_775_807n; } catch { return false; }
}
