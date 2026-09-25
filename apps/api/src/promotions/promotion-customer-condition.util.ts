import { PromotionCustomerCondition, PromotionCustomerConditionOperator, PromotionCustomerConditionType } from "./entities";

export type CustomerCommerceStats = {
  completedOrderCount: bigint;
  completedSpendToman: bigint;
  lastCompletedOrderAt: Date | null;
  registeredAt: Date;
};

export type CustomerEvaluationContext = {
  customerId: string;
  stats: CustomerCommerceStats;
  segmentIds: Set<string>;
  firstOrderClaims: Set<string>;
};

export type CustomerEligibilityFailure =
  | "AUTHENTICATED_CUSTOMER_REQUIRED"
  | "FIRST_ORDER_REQUIRED"
  | "ORDER_COUNT_NOT_MET"
  | "MIN_TOTAL_SPEND_NOT_MET"
  | "INACTIVITY_PERIOD_NOT_MET"
  | "REGISTRATION_AGE_NOT_MET"
  | "CUSTOMER_NOT_IN_REQUIRED_SEGMENT";

const DAY_MS = 86_400_000;

export function customerConditionFailure(
  promotionId: string,
  conditions: PromotionCustomerCondition[],
  customer: CustomerEvaluationContext | null,
  now: Date,
): CustomerEligibilityFailure | null {
  if (!conditions.length) return null;
  if (!customer) return "AUTHENTICATED_CUSTOMER_REQUIRED";

  for (const condition of [...conditions].sort((a, b) => a.type.localeCompare(b.type))) {
    const value = BigInt(condition.value ?? "0");
    if (condition.type === PromotionCustomerConditionType.FirstOrder) {
      if (customer.stats.completedOrderCount !== 0n || customer.firstOrderClaims.has(promotionId)) return "FIRST_ORDER_REQUIRED";
    } else if (condition.type === PromotionCustomerConditionType.OrderCount) {
      const count = customer.stats.completedOrderCount;
      const passes = condition.operator === PromotionCustomerConditionOperator.AtLeast ? count >= value
        : condition.operator === PromotionCustomerConditionOperator.AtMost ? count <= value
          : condition.operator === PromotionCustomerConditionOperator.Exactly ? count === value : false;
      if (!passes) return "ORDER_COUNT_NOT_MET";
    } else if (condition.type === PromotionCustomerConditionType.TotalSpent) {
      if (customer.stats.completedSpendToman < value) return "MIN_TOTAL_SPEND_NOT_MET";
    } else if (condition.type === PromotionCustomerConditionType.LastOrderAge) {
      const lastOrderAt = customer.stats.lastCompletedOrderAt;
      if (!lastOrderAt || now.getTime() - lastOrderAt.getTime() < Number(value) * DAY_MS) return "INACTIVITY_PERIOD_NOT_MET";
    } else if (condition.type === PromotionCustomerConditionType.RegistrationAge) {
      const age = now.getTime() - customer.stats.registeredAt.getTime();
      const duration = Number(value) * DAY_MS;
      const passes = condition.operator === PromotionCustomerConditionOperator.WithinLast ? age >= 0 && age <= duration : age >= duration;
      if (!passes) return "REGISTRATION_AGE_NOT_MET";
    } else if (condition.type === PromotionCustomerConditionType.CustomerSegment) {
      if (!condition.customerSegmentId || !customer.segmentIds.has(condition.customerSegmentId)) return "CUSTOMER_NOT_IN_REQUIRED_SEGMENT";
    }
  }
  return null;
}
