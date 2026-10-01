export type PublicPlan = {
  key: string; name: string; description: string; priceToman: string; billingMonths: number;
  trialDays: number; graceDays: number; sortOrder: number;
  features: Array<{ key: string; label: string; included: boolean }>;
  highlightedFeatures: Array<{ key: string; label: string; included: boolean }>;
};
export type PublicCatalog = { plans: PublicPlan[] };
export function toman(value: string) { return new Intl.NumberFormat("fa-IR").format(BigInt(value)); }
export function persianNumber(value: number) { return new Intl.NumberFormat("fa-IR").format(value); }
