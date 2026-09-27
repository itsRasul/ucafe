import assert from "node:assert/strict";
import test from "node:test";
import { isTransientWorkflowError, triggerMatches, workflowLoopBlocked, workflowRetryDelayMs, workflowSafeError } from "./crm-workflow.util";

test("workflow triggers match configured transitions and score threshold crossings once per crossing", () => {
  assert.equal(triggerMatches("DEAL_STAGE_CHANGED", { toStage: "DEMO_COMPLETED" }, "DEAL_STAGE_CHANGED", { fromStage: "DEMO_SCHEDULED", toStage: "DEMO_COMPLETED" }), true);
  assert.equal(triggerMatches("DEAL_STAGE_CHANGED", { toStage: "DEMO_COMPLETED" }, "DEAL_STAGE_CHANGED", { fromStage: "DISCOVERY", toStage: "DECISION" }), false);
  assert.equal(triggerMatches("LEAD_SCORE_CROSSED_THRESHOLD", { threshold: 80, direction: "ABOVE" }, "LEAD_SCORE_CHANGED", { previousOverallScore: 79, overallScore: 81 }), true);
  assert.equal(triggerMatches("LEAD_SCORE_CROSSED_THRESHOLD", { threshold: 80, direction: "ABOVE" }, "LEAD_SCORE_CHANGED", { previousOverallScore: 81, overallScore: 83 }), false);
  assert.equal(triggerMatches("LEAD_SCORE_CROSSED_THRESHOLD", { threshold: 80, direction: "BELOW" }, "LEAD_SCORE_CHANGED", { previousOverallScore: 80, overallScore: 79 }), true);
  assert.equal(triggerMatches("LEAD_SCORE_CROSSED_THRESHOLD", { threshold: 80, direction: "ABOVE" }, "LEAD_SCORE_CHANGED", { previousOverallScore: null, overallScore: 81 }), false);
  assert.equal(triggerMatches("LEAD_SCORE_CROSSED_THRESHOLD", { threshold: 80, direction: "ABOVE" }, "LEAD_SCORE_CHANGED", { previousOverallScore: 80, overallScore: 81 }), false);
  assert.equal(triggerMatches("LEAD_SCORE_CROSSED_THRESHOLD", { threshold: 80, direction: "ABOVE" }, "TASK_COMPLETED", { previousOverallScore: 79, overallScore: 81 }), false);
});

test("workflow retries are bounded and loop depth has a fixed ceiling", () => {
  assert.deepEqual([1, 2].map(workflowRetryDelayMs), [2_000, 10_000]);
  assert.equal(workflowLoopBlocked(4), false);
  assert.equal(workflowLoopBlocked(5), true);
  assert.equal(isTransientWorkflowError({ driverError: { code: "40001" } }), true);
  assert.equal(isTransientWorkflowError({ driverError: { code: "23505" } }), false);
  assert.deepEqual(workflowSafeError(new Error("private SQL, user text, or token")), {
    code: "ACTION_REJECTED",
    message: "The action could not be completed. Check that its CRM record, tag, and assignee are still active.",
  });
  assert.equal(workflowSafeError({ driverError: { code: "08006" } }).code, "TEMPORARY_DATABASE_ERROR");
});
