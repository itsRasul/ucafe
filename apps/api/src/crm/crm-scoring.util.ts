export enum CrmScoringCategory { Fit = "FIT", Engagement = "ENGAGEMENT" }

export type ScoringContribution = {
  ruleId: string;
  ruleName: string;
  category: CrmScoringCategory;
  points: number;
};

export function calculateLeadScores(contributions: ScoringContribution[]) {
  const category = (name: CrmScoringCategory.Fit | CrmScoringCategory.Engagement) => {
    const items = contributions.filter((item) => item.category === name);
    const rawTotal = items.reduce((total, item) => total + item.points, 0);
    return { rawTotal, score: Math.max(0, Math.min(100, rawTotal)), contributions: items };
  };
  const fit = category(CrmScoringCategory.Fit);
  const engagement = category(CrmScoringCategory.Engagement);
  return { fitScore: fit.score, engagementScore: engagement.score, overallScore: Math.round((fit.score + engagement.score) / 2), breakdown: { fit, engagement } };
}

export function scoreBand(score: number): "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH" {
  return score < 40 ? "LOW" : score < 70 ? "MEDIUM" : score < 85 ? "HIGH" : "VERY_HIGH";
}

export function usesLeadScoreField(criteria: unknown) {
  if (!criteria || typeof criteria !== "object" || !Array.isArray((criteria as Record<string, unknown>).conditions)) return false;
  return ((criteria as { conditions: unknown[] }).conditions).some((condition) => Boolean(condition && typeof condition === "object" && ["fitScore", "engagementScore", "overallScore", "scoreCalculatedAt"].includes(String((condition as Record<string, unknown>).field))));
}
