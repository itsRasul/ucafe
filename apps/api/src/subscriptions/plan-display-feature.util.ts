import { PlanDisplayFeature } from "./subscription-features";

export type PlanDisplayFeatureValueRow = PlanDisplayFeature & { planId: string; planKey: string; featureId: string };

export function groupPlanDisplayFeatures(rows: PlanDisplayFeatureValueRow[]) {
  const grouped = new Map<string, PlanDisplayFeature[]>();
  for (const row of rows) {
    const features = grouped.get(row.planId) ?? [];
    features.push({ key: row.key, label: row.label, value: row.value, sortOrder: row.sortOrder });
    grouped.set(row.planId, features);
  }
  for (const features of grouped.values()) features.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  return grouped;
}
