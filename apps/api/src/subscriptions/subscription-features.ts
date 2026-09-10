export const SubscriptionFeatures = {
  Menu: "menu",
  Reservations: "reservations",
  OnlineOrdering: "onlineOrdering",
} as const;

export type SubscriptionFeatureKey = (typeof SubscriptionFeatures)[keyof typeof SubscriptionFeatures];

export const planModuleFeatures = [SubscriptionFeatures.Reservations, SubscriptionFeatures.OnlineOrdering] as const;

export function mergePlanFeatures(current: Record<string, boolean> | null | undefined, input?: Partial<Record<(typeof planModuleFeatures)[number], boolean>>) {
  return {
    [SubscriptionFeatures.Menu]: current?.[SubscriptionFeatures.Menu] ?? true,
    [SubscriptionFeatures.Reservations]: input?.reservations ?? current?.[SubscriptionFeatures.Reservations] ?? false,
    [SubscriptionFeatures.OnlineOrdering]: input?.onlineOrdering ?? current?.[SubscriptionFeatures.OnlineOrdering] ?? false,
  };
}
