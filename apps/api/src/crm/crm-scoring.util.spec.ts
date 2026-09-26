import assert from "node:assert/strict";
import test from "node:test";
import { calculateLeadScores, CrmScoringCategory, scoreBand, usesLeadScoreField } from "./crm-scoring.util";

test("lead scores clamp signed category totals and average both categories", () => {
  const result = calculateLeadScores([
    { ruleId: "1", ruleName: "fit", category: CrmScoringCategory.Fit, points: 80 },
    { ruleId: "2", ruleName: "penalty", category: CrmScoringCategory.Fit, points: -10 },
    { ruleId: "3", ruleName: "engagement", category: CrmScoringCategory.Engagement, points: 50 },
    { ruleId: "4", ruleName: "bonus", category: CrmScoringCategory.Engagement, points: 70 },
  ]);
  assert.equal(result.fitScore, 70);
  assert.equal(result.engagementScore, 100);
  assert.equal(result.overallScore, 85);
  assert.equal(result.breakdown.fit.rawTotal, 70);
  assert.equal(result.breakdown.engagement.rawTotal, 120);
  assert.equal(result.breakdown.fit.contributions.length, 2);
});

test("negative-only and empty categories remain bounded and stable", () => {
  assert.deepEqual(calculateLeadScores([{ ruleId: "1", ruleName: "negative", category: CrmScoringCategory.Fit, points: -20 }]), {
    fitScore: 0, engagementScore: 0, overallScore: 0,
    breakdown: { fit: { rawTotal: -20, score: 0, contributions: [{ ruleId: "1", ruleName: "negative", category: "FIT", points: -20 }] }, engagement: { rawTotal: 0, score: 0, contributions: [] } },
  });
  assert.equal(scoreBand(39), "LOW");
  assert.equal(scoreBand(40), "MEDIUM");
  assert.equal(scoreBand(70), "HIGH");
  assert.equal(scoreBand(85), "VERY_HIGH");
});

test("scoring criteria cannot refer to calculated score fields", () => {
  assert.equal(usesLeadScoreField({ version: 1, logic: "AND", conditions: [{ field: "overallScore", operator: "gte", value: 80 }] }), true);
  assert.equal(usesLeadScoreField({ version: 1, logic: "AND", conditions: [{ field: "source", operator: "is", value: "REFERRAL" }] }), false);
});
