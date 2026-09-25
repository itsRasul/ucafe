import assert from "node:assert/strict";
import test from "node:test";
import { PromotionCustomerCondition, PromotionCustomerConditionOperator as Operator, PromotionCustomerConditionType as Type } from "./entities";
import { CustomerEvaluationContext, customerConditionFailure } from "./promotion-customer-condition.util";

const now = new Date("2026-09-20T12:00:00.000Z");
const context = (overrides: Partial<CustomerEvaluationContext["stats"]> = {}): CustomerEvaluationContext => ({
  customerId: "client-a",
  stats: {
    completedOrderCount: 5n,
    completedSpendToman: 5_000_000n,
    lastCompletedOrderAt: new Date(now.getTime() - 31 * 86_400_000),
    registeredAt: new Date(now.getTime() - 7 * 86_400_000),
    ...overrides,
  },
  segmentIds: new Set(["vip"]),
  firstOrderClaims: new Set(),
});
const condition = (type: Type, operator: Operator | null = null, value: string | null = null, customerSegmentId: string | null = null) => ({ type, operator, value, customerSegmentId }) as PromotionCustomerCondition;

test("first order means no delivered orders and no active claim for that promotion", () => {
  assert.equal(customerConditionFailure("p1", [condition(Type.FirstOrder)], context({ completedOrderCount: 0n }), now), null);
  assert.equal(customerConditionFailure("p1", [condition(Type.FirstOrder)], context(), now), "FIRST_ORDER_REQUIRED");
  assert.equal(customerConditionFailure("p1", [condition(Type.FirstOrder)], { ...context({ completedOrderCount: 0n }), firstOrderClaims: new Set(["p1"]) }, now), "FIRST_ORDER_REQUIRED");
  assert.equal(customerConditionFailure("p1", [condition(Type.FirstOrder)], null, now), "AUTHENTICATED_CUSTOMER_REQUIRED");
});

test("order count and total spend use inclusive integer thresholds", () => {
  assert.equal(customerConditionFailure("p", [condition(Type.OrderCount, Operator.AtLeast, "5")], context(), now), null);
  assert.equal(customerConditionFailure("p", [condition(Type.OrderCount, Operator.AtMost, "4")], context(), now), "ORDER_COUNT_NOT_MET");
  assert.equal(customerConditionFailure("p", [condition(Type.OrderCount, Operator.Exactly, "5")], context(), now), null);
  assert.equal(customerConditionFailure("p", [condition(Type.TotalSpent, Operator.AtLeast, "5000000")], context(), now), null);
  assert.equal(customerConditionFailure("p", [condition(Type.TotalSpent, Operator.AtLeast, "5000001")], context(), now), "MIN_TOTAL_SPEND_NOT_MET");
});

test("inactivity excludes customers who have never completed an order", () => {
  assert.equal(customerConditionFailure("p", [condition(Type.LastOrderAge, Operator.AtLeast, "30")], context(), now), null);
  assert.equal(customerConditionFailure("p", [condition(Type.LastOrderAge, Operator.AtLeast, "32")], context(), now), "INACTIVITY_PERIOD_NOT_MET");
  assert.equal(customerConditionFailure("p", [condition(Type.LastOrderAge, Operator.AtLeast, "1")], context({ lastCompletedOrderAt: null, completedOrderCount: 0n }), now), "INACTIVITY_PERIOD_NOT_MET");
});

test("registration age supports recent and minimum-age audiences", () => {
  assert.equal(customerConditionFailure("p", [condition(Type.RegistrationAge, Operator.WithinLast, "7")], context(), now), null);
  assert.equal(customerConditionFailure("p", [condition(Type.RegistrationAge, Operator.AtLeast, "7")], context(), now), null);
  assert.equal(customerConditionFailure("p", [condition(Type.RegistrationAge, Operator.WithinLast, "6")], context(), now), "REGISTRATION_AGE_NOT_MET");
  assert.equal(customerConditionFailure("p", [condition(Type.RegistrationAge, Operator.AtLeast, "8")], context(), now), "REGISTRATION_AGE_NOT_MET");
});

test("segment membership and multiple customer conditions compose with AND", () => {
  assert.equal(customerConditionFailure("p", [condition(Type.CustomerSegment, null, null, "vip")], context(), now), null);
  assert.equal(customerConditionFailure("p", [condition(Type.CustomerSegment, null, null, "staff")], context(), now), "CUSTOMER_NOT_IN_REQUIRED_SEGMENT");
  assert.equal(customerConditionFailure("p", [condition(Type.CustomerSegment, null, null, "vip"), condition(Type.OrderCount, Operator.AtLeast, "6")], context(), now), "ORDER_COUNT_NOT_MET");
});
