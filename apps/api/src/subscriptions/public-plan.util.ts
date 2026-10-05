import { PlanStatus, SubscriptionPlan } from "./entities";
import { PlanDisplayFeature, projectPlanFeatures, subscriptionFeatureCatalog } from "./subscription-features";

export function publicPlanCatalog(plans: SubscriptionPlan[], displayFeaturesByPlan = new Map<string, PlanDisplayFeature[]>()) {
  const publicPlans = plans.filter((plan) => plan.status === PlanStatus.Active).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)).map((plan) => {
    const features = projectPlanFeatures(plan.features).map(({ key, label, order, value }) => ({ key, label, order, included: value === true }));
    return {
      key: plan.key, name: plan.name, description: plan.description, priceToman: plan.priceToman,
      billingMonths: plan.billingMonths, trialDays: plan.trialDays, graceDays: plan.graceDays, sortOrder: plan.sortOrder,
      features, displayFeatures: displayFeaturesByPlan.get(plan.id) ?? [],
      highlightedFeatures: features.filter((feature) => plan.highlightedFeatureKeys.includes(feature.key) && feature.included),
    };
  });
  return {
    featureCatalog: subscriptionFeatureCatalog.map(({ key, label, order }) => ({ key, label, order })),
    plans: publicPlans,
  };
}
