import assert from "node:assert/strict";
import test from "node:test";
import { CRM_DEAL_STAGES, crmDealStageRequiresReason, isValidCrmDealAmount, isValidCrmDealDate } from "./crm-deal-lifecycle.util";
import { CrmDealStage as S } from "./entities/crm-deal.entity";

test("default stages are ordered and require reasons for skips or backward corrections", () => {
  assert.deepEqual(CRM_DEAL_STAGES, [S.Discovery, S.DemoScheduled, S.DemoCompleted, S.TrialProposed, S.TrialActive, S.Decision]);
  assert.equal(crmDealStageRequiresReason(S.Discovery, S.DemoScheduled), false);
  assert.equal(crmDealStageRequiresReason(S.Discovery, S.DemoCompleted), true);
  assert.equal(crmDealStageRequiresReason(S.TrialActive, S.DemoCompleted), true);
});

test("deal amount and close date validation preserve integer toman and ISO calendar dates", () => {
  assert.equal(isValidCrmDealAmount("0"), true);
  assert.equal(isValidCrmDealAmount("9223372036854775807"), true);
  assert.equal(isValidCrmDealAmount("9223372036854775808"), false);
  assert.equal(isValidCrmDealDate("2026-09-26"), true);
  assert.equal(isValidCrmDealDate("2026-02-30"), false);
});
