export const SubscriptionFeatures = {
  Menu: "menu",
  Reservations: "reservations",
  OnlineOrdering: "onlineOrdering",
  Analytics: "analytics",
  Inventory: "inventory",
} as const;

export type SubscriptionFeatureKey = (typeof SubscriptionFeatures)[keyof typeof SubscriptionFeatures];

export type PlanFeatureValue = boolean | number | string | null;

export const subscriptionFeatureCatalog = [
  { key: SubscriptionFeatures.Menu, label: "منوی دیجیتال", type: "BOOLEAN", order: 10, enforcement: "BOOLEAN_TRUE" },
  { key: SubscriptionFeatures.Reservations, label: "رزرو میز", type: "BOOLEAN", order: 20, enforcement: "BOOLEAN_TRUE" },
  { key: SubscriptionFeatures.OnlineOrdering, label: "سفارش آنلاین", type: "BOOLEAN", order: 30, enforcement: "BOOLEAN_TRUE" },
  { key: SubscriptionFeatures.Analytics, label: "آمار و گزارش‌های مالی", type: "BOOLEAN", order: 40, enforcement: "BOOLEAN_TRUE" },
  { key: SubscriptionFeatures.Inventory, label: "مدیریت موجودی", type: "BOOLEAN", order: 50, enforcement: "BOOLEAN_TRUE" },
] as const;

export function projectPlanFeatures(features: Record<string, PlanFeatureValue>) {
  return subscriptionFeatureCatalog.map((definition) => ({ ...definition, value: features[definition.key] ?? false }));
}

export const planModuleFeatures = [SubscriptionFeatures.Menu, SubscriptionFeatures.Reservations, SubscriptionFeatures.OnlineOrdering, SubscriptionFeatures.Analytics, SubscriptionFeatures.Inventory] as const;

export function mergePlanFeatures(current: Record<string, PlanFeatureValue> | null | undefined, input?: Partial<Record<(typeof planModuleFeatures)[number], boolean>>) {
  return {
    ...current,
    [SubscriptionFeatures.Menu]: input?.menu ?? current?.[SubscriptionFeatures.Menu] ?? true,
    [SubscriptionFeatures.Reservations]: input?.reservations ?? current?.[SubscriptionFeatures.Reservations] ?? false,
    [SubscriptionFeatures.OnlineOrdering]: input?.onlineOrdering ?? current?.[SubscriptionFeatures.OnlineOrdering] ?? false,
    [SubscriptionFeatures.Analytics]: input?.analytics ?? current?.[SubscriptionFeatures.Analytics] ?? false,
    [SubscriptionFeatures.Inventory]: input?.inventory ?? current?.[SubscriptionFeatures.Inventory] ?? false,
  };
}
