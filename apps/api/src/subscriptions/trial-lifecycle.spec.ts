import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { CoffeeShop, CoffeeShopStatus } from "../database/entities";
import { PlanStatus, Subscription, SubscriptionPlan, SubscriptionStatus } from "./entities";
import { SubscriptionsService } from "./subscriptions.service";
import { addDays } from "./subscription-lifecycle";
import { TRIAL_DAYS } from "./trial-policy";
import { dueTrialReminder } from "../notifications/trial-reminder";
import { NotificationType } from "../notifications/notification-type";
import { SubscriptionFeatureGuard } from "./subscription-feature.guard";
import { TENANT_CONTEXT } from "../tenants/tenant-context";

const now = new Date("2026-10-05T10:00:00Z");
const silver = Object.assign(new SubscriptionPlan(), { id: "silver-id", key: "silver", status: PlanStatus.Active, graceDays: 7, trialDays: 7, features: { menu: true, analytics: false } });
const golden = Object.assign(new SubscriptionPlan(), { id: "golden-id", key: "golden", status: PlanStatus.Active, features: { menu: true, analytics: true, tenant_crm: true } });

function fixture(subscription: Subscription | null) {
  const cafe = { id: "tenant", status: CoffeeShopStatus.Draft };
  const manager = {
    query: async () => [], existsBy: async () => Boolean(subscription),
    findOneBy: async (entity: unknown, where: { key?: string }) => entity === CoffeeShop ? cafe : where.key === "golden" ? golden : silver,
    getRepository: () => ({ findOne: async () => subscription }),
    create: (_entity: unknown, value: unknown) => value,
    save: async (_entity: unknown, value?: unknown) => value ?? _entity,
  };
  const db = { manager, getRepository: manager.getRepository, transaction: async (fn: (m: typeof manager) => unknown) => fn(manager) };
  return new SubscriptionsService(db as never, {} as never);
}

test("new explicit trial lasts 30 elapsed UTC days and preserves selected paid plan", async () => {
  const subscription = await fixture(null).startTrial("tenant", "silver", now);
  assert.equal(subscription.planId, silver.id);
  assert.equal(subscription.trialStartedAt, now);
  assert.equal(subscription.trialEndsAt?.toISOString(), "2026-11-04T10:00:00.000Z");
  assert.equal(TRIAL_DAYS, 30);
  await assert.rejects(fixture(subscription).startTrial("tenant", "silver", now));
});

test("trial uses dynamic Golden features; exact expiry denies; paid conversion uses Silver", async () => {
  const subscription: Subscription = Object.assign(new Subscription(), { plan: silver, planId: silver.id, status: SubscriptionStatus.Trialing, trialEndsAt: addDays(now, 30), currentPeriodEndsAt: null, paidThroughAt: null });
  const service = fixture(subscription);
  assert.equal((await service.featureState("tenant", "analytics", now)).enabled, true);
  golden.features.analytics = false;
  assert.equal((await service.featureState("tenant", "analytics", now)).enabled, false);
  golden.features.analytics = true;
  assert.equal((await service.featureState("tenant", "menu", subscription.trialEndsAt!)).enabled, false);
  assert.equal((await service.featureState("tenant", "menu", subscription.trialEndsAt!)).reason, "TRIAL_EXPIRED");
  subscription.trialEndsAt = addDays(new Date(), -1);
  await assert.rejects(service.requireFeature("tenant", "menu"), ForbiddenException);
  subscription.paidThroughAt = addDays(new Date(), 30);
  assert.equal((await service.featureState("tenant", "menu")).enabled, true);
  assert.equal((await service.featureState("tenant", "analytics")).enabled, false);
});

test("controller feature guard denies direct API execution before the handler", async () => {
  let tenantId = "";
  const guard = new SubscriptionFeatureGuard({ getAllAndOverride: () => "menu" } as never, { requireFeature: async (id: string) => { tenantId = id; throw new ForbiddenException(); } } as never);
  const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ [TENANT_CONTEXT]: { coffeeShopId: "resolved-tenant" } }) }) };
  await assert.rejects(guard.canActivate(context as never), ForbiddenException);
  assert.equal(tenantId, "resolved-tenant");
});

test("trial reminder windows catch up without sending stale messages", () => {
  for (const [days, expected] of [[8, null], [7, NotificationType.TrialExpires7Days], [6.01, NotificationType.TrialExpires7Days], [3, null], [2, NotificationType.TrialExpires2Days], [1.01, NotificationType.TrialExpires2Days], [0.01, null], [0, NotificationType.TrialExpired], [-2.99, NotificationType.TrialExpired], [-3, NotificationType.TrialExpiredFollowUp], [-6, NotificationType.TrialExpiredFollowUp], [-7, null], [-8, null]] as const) {
    assert.equal(dueTrialReminder(addDays(now, days), now), expected);
  }
});
