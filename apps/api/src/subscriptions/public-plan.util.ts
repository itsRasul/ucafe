import { PlanStatus, SubscriptionPlan } from "./entities";
import { projectPlanFeatures } from "./subscription-features";

export function publicPlanCatalog(plans: SubscriptionPlan[]) {
  return plans.filter((plan) => plan.status === PlanStatus.Active).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)).map((plan) => {
    const features = projectPlanFeatures(plan.features).map(({ key, label, value }) => ({ key, label, included: value === true }));
    return {
      key: plan.key, name: plan.name, description: plan.description, priceToman: plan.priceToman,
      billingMonths: plan.billingMonths, trialDays: plan.trialDays, graceDays: plan.graceDays, sortOrder: plan.sortOrder,
      features, highlightedFeatures: features.filter((feature) => plan.highlightedFeatureKeys.includes(feature.key) && feature.included),
    };
  });
}
