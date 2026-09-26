import assert from "node:assert/strict";
import test from "node:test";
import { SubscriptionsService } from "./subscriptions.service";
import { Subscription, SubscriptionStatus } from "./entities";
import { renewalWindow } from "./subscription-summary.util";

const now = new Date("2026-09-08T08:00:00.000Z");

test("renewal warning starts three days before period end", () => {
  assert.deepEqual(renewalWindow(new Date("2026-09-11T08:00:00.000Z"), now), { daysUntilPeriodEnd: 3, isRenewalWarning: true });
});

test("renewal warning is quiet before the three-day window", () => {
  assert.deepEqual(renewalWindow(new Date("2026-09-12T08:00:00.000Z"), now), { daysUntilPeriodEnd: 4, isRenewalWarning: false });
});

test("renewal warning does not show after the entitlement end has passed", () => {
  assert.deepEqual(renewalWindow(new Date("2026-09-07T08:00:00.000Z"), now), { daysUntilPeriodEnd: 0, isRenewalWarning: false });
});

test("CRM subscription context projects trial, grace, and due plan changes without mutating source data", async () => {
  const currentPlan = { id: "current", key: "silver", name: "Silver", graceDays: 7 };
  const pendingPlan = { id: "pending", key: "golden", name: "Golden", graceDays: 3 };
  const trial = {
    status: SubscriptionStatus.Trialing, plan: currentPlan, pendingPlan: null, pendingPlanEffectiveAt: null,
    trialStartedAt: new Date("2026-09-06T08:00:00.000Z"), trialEndsAt: new Date("2026-09-11T08:00:00.000Z"),
    currentPeriodStartedAt: null, currentPeriodEndsAt: null, paidThroughAt: null, graceEndsAt: null,
  } as unknown as Subscription;
  const source = { ...trial };
  const dataSource = { getRepository: () => ({ findOne: async () => trial }) } as never;
  const service = new SubscriptionsService(dataSource, null as never);
  const projectedTrial = await service.getCrmContext("tenant", now);
  assert.equal(projectedTrial?.status, SubscriptionStatus.Trialing);
  assert.equal(projectedTrial?.trial?.status, "ACTIVE");
  assert.equal(projectedTrial?.trial?.daysRemaining, 3);
  assert.deepEqual(trial, source);

  const grace = { ...trial, status: SubscriptionStatus.Active, trialStartedAt: null, trialEndsAt: null,
    currentPeriodStartedAt: new Date("2026-08-01T08:00:00.000Z"), currentPeriodEndsAt: new Date("2026-09-01T08:00:00.000Z"),
    paidThroughAt: new Date("2026-09-01T08:00:00.000Z"), graceEndsAt: new Date("2026-09-10T08:00:00.000Z") } as unknown as Subscription;
  const projectedGrace = await new SubscriptionsService({ getRepository: () => ({ findOne: async () => grace }) } as never, null as never).getCrmContext("tenant", now);
  assert.equal(projectedGrace?.status, SubscriptionStatus.Grace);
  assert.equal(projectedGrace?.graceDaysRemaining, 2);

  const dueChange = { ...grace, pendingPlan, pendingPlanEffectiveAt: new Date("2026-09-07T08:00:00.000Z") } as unknown as Subscription;
  const projectedChange = await new SubscriptionsService({ getRepository: () => ({ findOne: async () => dueChange }) } as never, null as never).getCrmContext("tenant", now);
  assert.equal(projectedChange?.plan.name, "Golden");
  assert.equal(projectedChange?.pendingChange, null);
  assert.equal(dueChange.plan.name, "Silver", "a due plan is projected without updating the Subscription");
});
