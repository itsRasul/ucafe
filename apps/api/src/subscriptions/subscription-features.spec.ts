import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { mergePlanFeatures, SubscriptionFeatures } from "./subscription-features";
import { SubscriptionStatus, SubscriptionPlan } from "./entities";
import { SubscriptionsService } from "./subscriptions.service";

test("plan module updates preserve existing non-module features", () => {
  assert.deepEqual(mergePlanFeatures({ menu: false }, { reservations: true, onlineOrdering: false }), {
    [SubscriptionFeatures.Menu]: false,
    [SubscriptionFeatures.Reservations]: true,
    [SubscriptionFeatures.OnlineOrdering]: false,
    [SubscriptionFeatures.Analytics]: false,
    [SubscriptionFeatures.Inventory]: false,
  });
});

test("plan module updates keep existing values when a module is omitted", () => {
  assert.deepEqual(mergePlanFeatures({ menu: true, reservations: true, onlineOrdering: false }, { onlineOrdering: true }), {
    [SubscriptionFeatures.Menu]: true,
    [SubscriptionFeatures.Reservations]: true,
    [SubscriptionFeatures.OnlineOrdering]: true,
    [SubscriptionFeatures.Analytics]: false,
    [SubscriptionFeatures.Inventory]: false,
  });
});

test("plan edits preserve unknown legacy feature keys", () => {
  assert.deepEqual(mergePlanFeatures({ menu: true, legacyReports: "limited" }, { reservations: true }), {
    menu: true,
    legacyReports: "limited",
    reservations: true,
    onlineOrdering: false,
    analytics: false,
    inventory: false,
  });
});

test("analytics is edited as a plan feature without replacing other settings", () => {
  const enabled = mergePlanFeatures({ menu: true, onlineOrdering: true, analytics: false }, { analytics: true });
  assert.equal(enabled.analytics, true);
  assert.equal(enabled.onlineOrdering, true);
  assert.equal(mergePlanFeatures(enabled, { analytics: false }).analytics, false);
});

test("inventory can be enabled or removed on any plan and does not depend on plan key", async () => {
  const enabled = mergePlanFeatures({ menu: true }, { inventory: true });
  assert.equal(enabled.inventory, true);
  assert.equal(mergePlanFeatures(enabled, { inventory: false }).inventory, false);
  const now = new Date("2026-09-23T00:00:00Z");
  const plan = { key: "silver", name: "Silver", features: enabled, graceDays: 7 };
  const subscription = { status: SubscriptionStatus.Active, plan, trialEndsAt: null, currentPeriodEndsAt: new Date("2026-10-01T00:00:00Z"), paidThroughAt: new Date("2026-10-01T00:00:00Z"), graceEndsAt: null };
  const service = new SubscriptionsService({ getRepository: () => ({ findOne: async () => subscription }) } as never, {} as never);
  assert.equal((await service.featureState("tenant-a", SubscriptionFeatures.Inventory, now)).enabled, true);
  plan.features.inventory = false;
  assert.equal((await service.featureState("tenant-a", SubscriptionFeatures.Inventory, now)).enabled, false);
  plan.key = "golden";
  assert.equal((await service.featureState("tenant-a", SubscriptionFeatures.Inventory, now)).enabled, false);
});

test("analytics entitlement follows feature value and subscription lifecycle, not plan name", async () => {
  const now = new Date("2026-09-23T00:00:00Z");
  const plan = { key: "silver", name: "Silver", features: { analytics: true }, graceDays: 7 };
  const subscription = { status: SubscriptionStatus.Active, plan, trialEndsAt: null, currentPeriodEndsAt: new Date("2026-10-01T00:00:00Z"), paidThroughAt: new Date("2026-10-01T00:00:00Z"), graceEndsAt: null };
  const service = new SubscriptionsService({ getRepository: () => ({ findOne: async () => subscription }) } as never, {} as never);
  assert.equal((await service.featureState("tenant-a", SubscriptionFeatures.Analytics, now)).enabled, true);
  plan.features.analytics = false;
  assert.equal((await service.featureState("tenant-a", SubscriptionFeatures.Analytics, now)).enabled, false);
  plan.key = "golden"; plan.features.analytics = true;
  assert.equal((await service.featureState("tenant-a", SubscriptionFeatures.Analytics, now)).enabled, true);
  subscription.status = SubscriptionStatus.Suspended;
  Object.assign(subscription, { currentPeriodEndsAt: new Date("2026-09-01T00:00:00Z"), paidThroughAt: new Date("2026-09-01T00:00:00Z") });
  assert.equal((await service.featureState("tenant-a", SubscriptionFeatures.Analytics, now)).enabled, false);
  subscription.status = SubscriptionStatus.Trialing;
  Object.assign(subscription, { trialEndsAt: new Date("2026-09-24T00:00:00Z"), currentPeriodEndsAt: null, paidThroughAt: null });
  assert.equal((await service.featureState("tenant-a", SubscriptionFeatures.Analytics, now)).enabled, true);
  subscription.status = SubscriptionStatus.Active;
  Object.assign(subscription, { currentPeriodEndsAt: new Date("2026-09-22T00:00:00Z"), paidThroughAt: new Date("2026-09-22T00:00:00Z") });
  assert.equal((await service.featureState("tenant-a", SubscriptionFeatures.Analytics, now)).status, SubscriptionStatus.Grace);
  assert.equal((await service.featureState("tenant-a", SubscriptionFeatures.Analytics, now)).enabled, true);
});

test("Golden defaults on and platform plan edits can turn it off or enable Silver", { skip: !process.env.ANALYTICS_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.ANALYTICS_INTEGRATION_DATABASE_URL, entities: [SubscriptionPlan] });
  await db.initialize();
  const rollback = new Error(`rollback ${randomUUID()}`);
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const service = new SubscriptionsService({ getRepository: (entity: typeof SubscriptionPlan) => manager.getRepository(entity) } as never, {} as never);
      const golden = await manager.getRepository(SubscriptionPlan).findOneByOrFail({ key: "golden" });
      const silver = await manager.getRepository(SubscriptionPlan).findOneByOrFail({ key: "silver" });
      assert.equal(golden.features.analytics, true);
      assert.equal(golden.features.inventory, true);
      assert.notEqual(silver.features.analytics, true);
      assert.notEqual(silver.features.inventory, true);
      await service.updatePlan("golden", { features: { analytics: false } });
      await service.updatePlan("silver", { features: { analytics: true, inventory: true } });
      assert.equal((await manager.getRepository(SubscriptionPlan).findOneByOrFail({ key: "golden" })).features.analytics, false);
      assert.equal((await manager.getRepository(SubscriptionPlan).findOneByOrFail({ key: "golden" })).features.inventory, true);
      const silverAfterEnable = await manager.getRepository(SubscriptionPlan).findOneByOrFail({ key: "silver" });
      assert.equal(silverAfterEnable.features.analytics, true);
      assert.equal(silverAfterEnable.features.inventory, true);
      await service.updatePlan("silver", { features: { inventory: false } });
      assert.equal((await manager.getRepository(SubscriptionPlan).findOneByOrFail({ key: "silver" })).features.inventory, false);
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.destroy(); }
});
