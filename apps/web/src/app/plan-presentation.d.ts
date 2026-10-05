export type PlanFunctionalFeature = { key: string; label: string; order?: number; included?: boolean; value?: boolean | number | string | null };
export type PlanDisplayFeature = { key: string; label: string; value: string; sortOrder: number };
export type PlanFeatureDefinition = { key: string; label: string; order: number };
export type PlanForComparison = { key: string; features: PlanFunctionalFeature[]; displayFeatures?: PlanDisplayFeature[] };
export type PlanCardFeatureRow = { key: string; label: string; checked: boolean; kind: "functional" | "display" };
export type PlanComparisonRow = { key: string; featureKey: string; label: string; kind: "functional" | "display"; values: Record<string, boolean | string | null> };
export function planCardFeatureRows(functionalFeatures: PlanFunctionalFeature[], displayFeatures: PlanDisplayFeature[], limit?: number): PlanCardFeatureRow[];
export function buildPlanComparisonRows(featureCatalog: PlanFeatureDefinition[], plans: PlanForComparison[]): PlanComparisonRow[];
