import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import source from "../database/data-source";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationDelivery } from "../notifications/entities";
import { NotificationType } from "../notifications/notification-type";
import { TenantsService } from "../tenants/tenants.service";
import { SubscriptionsService } from "./subscriptions.service";
import { Subscription, SubscriptionPlan } from "./entities";
import { addDays } from "./subscription-lifecycle";

const url = process.env.TRIAL_INTEGRATION_DATABASE_URL;
test("PostgreSQL: trial dates, outbox deduplication, conversion and recipient rechecks", { skip: !url && "Set TRIAL_INTEGRATION_DATABASE_URL to a migrated development database" }, async () => {
  const db = new DataSource({ type: "postgres", entities: source.options.entities, url, migrations: [], logging: false });
  await db.initialize();
  const config = new ConfigService({ PLATFORM_BASE_DOMAIN: "u-cafe.localhost", AUTH_PEPPER: "trial-test-pepper-with-at-least-32-characters", PII_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"), SMS_PROVIDER: "development" });
  let tenantId: string | undefined;
  let userId: string | undefined;
  // Exercise real persistence without discovering reminders for unrelated local tenants.
  const scopedDb = Object.assign(Object.create(db), {
    transaction: (work: (manager: unknown) => Promise<unknown>) => db.transaction(async manager => {
      const scopedManager = Object.assign(Object.create(manager), { query: async (sql: string, parameters: unknown[]) => {
        if (sql.includes("FROM reservations r") || sql.includes("s.paid_through_at AS")) return [];
        const rows = await manager.query(sql, parameters);
        return sql.includes('s.trial_ends_at AS "trialEndsAt"') ? rows.filter((row: { coffeeShopId: string }) => row.coffeeShopId === tenantId) : rows;
      } });
      return work(scopedManager);
    }),
  });
  const notifications = new NotificationsService(scopedDb, new AuthCryptoService(config), config, { sendTemplate: async () => ({ providerMessageId: "test" }) } as never);
  const subscriptions = new SubscriptionsService(db, notifications);
  const scheduled = notifications as unknown as { enqueueScheduled: (now: Date) => Promise<void>; isStillEligible: (row: NotificationDelivery) => Promise<boolean> };
  const fixturePhone = `+989${randomInt(100000000, 999999999)}`;
  try {
    const tenant = await new TenantsService(db, config).provision({ name: "Trial lifecycle test", slug: `trial-test-${randomUUID().slice(0, 8)}`, ownerPhone: fixturePhone });
    tenantId = tenant.coffeeShopId;
    userId = (await db.query(`SELECT user_id FROM coffee_shop_memberships WHERE id=$1`, [tenant.ownerMembershipId]))[0].user_id;
    await db.query(`UPDATE coffee_shop_memberships SET status='ACTIVE', accepted_at=now() WHERE id=$1`, [tenant.ownerMembershipId]);
    const start = new Date();
    const trial = await subscriptions.startTrial(tenantId, "silver", start);
    assert.equal(trial.trialEndsAt!.getTime() - start.getTime(), 30 * 86_400_000);
    const golden = await db.getRepository(SubscriptionPlan).findOneByOrFail({ key: "golden" });
    assert.equal((await subscriptions.featureState(tenantId, "analytics")).enabled, golden.features.analytics === true);
    await assert.rejects(subscriptions.startTrial(tenantId, "silver"));

    for (const [offset, type] of [[7, NotificationType.TrialExpires7Days], [2, NotificationType.TrialExpires2Days], [0, NotificationType.TrialExpired], [-3, NotificationType.TrialExpiredFollowUp]] as const) {
      const end = addDays(new Date(), offset);
      await db.getRepository(Subscription).update(trial.id, { trialStartedAt: addDays(end, -30), trialEndsAt: end });
      await scheduled.enqueueScheduled(new Date());
      await scheduled.enqueueScheduled(new Date());
      const rows = await db.getRepository(NotificationDelivery).createQueryBuilder("d").addSelect("d.recipientCiphertext").where("d.coffee_shop_id=:id AND d.type=:type", { id: tenantId, type }).getMany();
      assert.equal(rows.length, 1, "repeat discovery must retain one event per owner and boundary");
      assert.equal(await scheduled.isStillEligible(rows[0]!), true);
      await db.query(`UPDATE coffee_shop_memberships SET status='SUSPENDED' WHERE id=$1`, [tenant.ownerMembershipId]);
      assert.equal(await scheduled.isStillEligible(rows[0]!), false);
      await db.query(`UPDATE coffee_shop_memberships SET status='ACTIVE' WHERE id=$1`, [tenant.ownerMembershipId]);
      await db.getRepository(Subscription).update(trial.id, { paidThroughAt: addDays(new Date(), 30) });
      assert.equal(await scheduled.isStillEligible(rows[0]!), false, "verified paid entitlement suppresses queued trial SMS");
      await db.getRepository(Subscription).update(trial.id, { paidThroughAt: null });
    }
    assert.equal((await subscriptions.featureState(tenantId, "menu")).reason, "TRIAL_EXPIRED");
    await assert.rejects(subscriptions.requireFeature(tenantId, "menu"));
    await db.getRepository(Subscription).update(trial.id, { paidThroughAt: addDays(new Date(), 30) });
    const silver = await db.getRepository(SubscriptionPlan).findOneByOrFail({ key: "silver" });
    assert.equal((await subscriptions.featureState(tenantId, "analytics")).enabled, silver.features.analytics === true);
    await scheduled.enqueueScheduled(new Date());
    assert.equal(await db.getRepository(NotificationDelivery).countBy({ coffeeShopId: tenantId }), 4);
  } finally {
    if (tenantId) await db.transaction(async manager => {
      await manager.query("DELETE FROM notification_deliveries WHERE coffee_shop_id=$1", [tenantId]);
      await manager.query("DELETE FROM subscriptions WHERE coffee_shop_id=$1", [tenantId]);
      await manager.query("DELETE FROM domains WHERE coffee_shop_id=$1", [tenantId]);
      await manager.query("DELETE FROM branches WHERE coffee_shop_id=$1", [tenantId]);
      await manager.query("DELETE FROM coffee_shop_memberships WHERE coffee_shop_id=$1", [tenantId]);
      await manager.query("DELETE FROM coffee_shops WHERE id=$1", [tenantId]);
      if (userId) await manager.query("DELETE FROM users WHERE id=$1", [userId]);
    });
    await db.destroy();
  }
});
