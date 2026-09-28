import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { validate } from "class-validator";
import { DataSource } from "typeorm";
import { TENANT_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { TenantPermissions } from "../authorization/permission.constants";
import { DomainEventTypes } from "../database/domain-event.constants";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { AdjustTenantCrmLoyaltyDto, CreateTenantCrmRewardDto, RedeemTenantCrmRewardDto, UpdateTenantCrmLoyaltyProgramDto,
  UpdateTenantCrmRewardDto } from "./dto/tenant-crm-loyalty.dto";
import { pointsForSpend } from "./loyalty-points.util";
import { TenantCrmLoyaltyController } from "./tenant-crm-loyalty.controller";
import { TenantCrmLoyaltyService } from "./tenant-crm-loyalty.service";

test("spend earning uses integer floor division and rejects invalid inputs", () => {
  assert.equal(pointsForSpend("29999", "10000"), 2n);
  assert.equal(pointsForSpend("90071992547409930000", "3"), 30023997515803310000n);
  assert.equal(pointsForSpend(9999n, 10000n), 0n);
  assert.throws(() => pointsForSpend(-1n, 100n), RangeError);
  assert.throws(() => pointsForSpend(100n, 0n), RangeError);
});

test("loyalty reads require CRM read and all mutations require CRM manage", () => {
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmLoyaltyController), [TenantPermissions.TenantCrmRead]);
  for (const method of ["updateProgram", "createReward", "updateReward", "adjust", "redeem"] as const) {
    assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmLoyaltyController.prototype[method]),
      [TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage]);
  }
});

test("manual idempotency keys cannot collide with Order or redemption ledger sources", async () => {
  const valid = Object.assign(new AdjustTenantCrmLoyaltyDto(), { direction: "CREDIT", points: 1, reason: "Correction", idempotencyKey: `adjust-${randomUUID()}` });
  assert.deepEqual(await validate(valid), []);
  for (const idempotencyKey of [`ORDER:${randomUUID()}`, `REDEMPTION:${randomUUID()}`]) {
    const input = Object.assign(new AdjustTenantCrmLoyaltyDto(), { ...valid, idempotencyKey });
    assert.ok((await validate(input)).some((error) => error.property === "idempotencyKey"));
  }
});

test("PostgreSQL ledger serializes redemption and processes duplicate delivery events once", {
  skip: !process.env.TENANT_CRM_INTEGRATION_DATABASE_URL,
}, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.TENANT_CRM_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const tenantA = randomUUID(), tenantB = randomUUID();
  const clientA = randomUUID(), clientB = randomUUID();
  const userA = randomUUID(), userB = randomUUID();
  const orderId = randomUUID(), pendingOrderId = randomUUID();
  const fakeSubscriptions = { featureState: async (_tenantId: string, feature: string) => {
    assert.equal(feature, SubscriptionFeatures.TenantCrm);
    return { enabled: true };
  } };
  const firstWorker = new TenantCrmLoyaltyService(db, fakeSubscriptions as never);
  const secondWorker = new TenantCrmLoyaltyService(db, fakeSubscriptions as never);
  const slugA = `loyalty-${tenantA.replaceAll("-", "").slice(0, 24)}`;
  const slugB = `loyalty-${tenantB.replaceAll("-", "").slice(0, 24)}`;
  try {
    await db.query(`INSERT INTO coffee_shops(id,name,slug,status,timezone) VALUES($1,'Loyalty test A',$2,'ACTIVE','Asia/Tehran'),($3,'Loyalty test B',$4,'ACTIVE','Asia/Tehran')`, [tenantA, slugA, tenantB, slugB]);
    await db.query(`INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone) VALUES($1,$2,'آوا','رضایی','+989120000081'),($3,$4,'آوا','رضایی','+989120000081')`, [clientA, tenantA, clientB, tenantB]);
    await db.query(`INSERT INTO users(id,email) VALUES($1,$2),($3,$4)`, [userA, `${userA}@loyalty.test`, userB, `${userB}@loyalty.test`]);
    await db.query(`INSERT INTO coffee_shop_memberships(coffee_shop_id,user_id,status) VALUES($1,$2,'ACTIVE'),($3,$4,'ACTIVE')`, [tenantA, userA, tenantB, userB]);

    const program = Object.assign(new UpdateTenantCrmLoyaltyProgramDto(), { enabled: true, spendPerPointToman: 100 });
    await firstWorker.updateProgram(tenantA, userA, program);
    await firstWorker.updateProgram(tenantB, userB, program);
    const rewardA = await firstWorker.createReward(tenantA, userA, Object.assign(new CreateTenantCrmRewardDto(), { name: "کاپوچینو", pointsCost: 80 }));
    const rewardB = await firstWorker.createReward(tenantB, userB, Object.assign(new CreateTenantCrmRewardDto(), { name: "کاپوچینو", pointsCost: 80 }));
    const credit = Object.assign(new AdjustTenantCrmLoyaltyDto(), {
      direction: "CREDIT" as const, points: 105, reason: "Service recovery", idempotencyKey: `credit-${randomUUID()}`,
    });
    await firstWorker.adjust(tenantA, clientA, userA, credit);
    assert.equal((await firstWorker.adjust(tenantA, clientA, userA, credit)).balance, "105");
    const debit = Object.assign(new AdjustTenantCrmLoyaltyDto(), {
      direction: "DEBIT" as const, points: 5, reason: "Correction", idempotencyKey: `debit-${randomUUID()}`,
    });
    assert.equal((await firstWorker.adjust(tenantA, clientA, userA, debit)).item.points, "-5");
    await assert.rejects(() => firstWorker.adjust(tenantA, clientA, userA, Object.assign(new AdjustTenantCrmLoyaltyDto(), {
      direction: "DEBIT" as const, points: 101, reason: "Too large", idempotencyKey: `debit-${randomUUID()}`,
    })), ConflictException);
    const actorRows = await db.query(`SELECT created_by_user_id AS "createdByUserId" FROM tenant_crm_loyalty_ledger WHERE coffee_shop_id=$1 AND idempotency_key=$2`,
      [tenantA, debit.idempotencyKey]) as Array<{ createdByUserId: string }>;
    assert.equal(actorRows[0]?.createdByUserId, userA);

    await assert.rejects(() => firstWorker.redeem(tenantA, clientA, userA,
      Object.assign(new RedeemTenantCrmRewardDto(), { rewardId: rewardB.id, idempotencyKey: `foreign-${randomUUID()}` })), NotFoundException);
    const redemptionKeys = [`redeem-a-${randomUUID()}`, `redeem-b-${randomUUID()}`];
    const attempts = await Promise.allSettled(redemptionKeys.map((idempotencyKey) => firstWorker.redeem(tenantA, clientA, userA,
      Object.assign(new RedeemTenantCrmRewardDto(), { rewardId: rewardA.id, idempotencyKey }))));
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((result) => result.status === "rejected" && result.reason instanceof ConflictException).length, 1);
    const successfulKey = redemptionKeys[attempts.findIndex((result) => result.status === "fulfilled")]!;
    const replayedRedemption = await firstWorker.redeem(tenantA, clientA, userA,
      Object.assign(new RedeemTenantCrmRewardDto(), { rewardId: rewardA.id, idempotencyKey: successfulKey }));
    await firstWorker.updateReward(tenantA, userA, rewardA.id, Object.assign(new UpdateTenantCrmRewardDto(), {
      name: "کاپوچینو ویژه", pointsCost: 90, isActive: false,
    }));
    const redemptionSnapshot = await db.query(`SELECT reward_name_snapshot AS "rewardName",points_spent::text AS "pointsSpent"
      FROM tenant_crm_loyalty_redemptions WHERE coffee_shop_id=$1 AND idempotency_key=$2`, [tenantA, successfulKey]) as Array<{ rewardName: string; pointsSpent: string }>;
    assert.deepEqual(redemptionSnapshot[0], { rewardName: "کاپوچینو", pointsSpent: "80" });
    await assert.rejects(() => firstWorker.redeem(tenantA, clientA, userA,
      Object.assign(new RedeemTenantCrmRewardDto(), { rewardId: rewardA.id, idempotencyKey: `inactive-${randomUUID()}` })), NotFoundException);

    await db.query(`INSERT INTO orders(id,coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,subtotal_before_discount_toman,discount_total_toman,order_discount_toman,idempotency_key,status_changed_at)
      VALUES($1,$2,$3,'DELIVERED','OFFLINE','PICKUP',250,250,0,0,$4,clock_timestamp()),($5,$2,$3,'UNDER_REVIEW','OFFLINE','PICKUP',1000,1000,0,0,$6,NULL)`,
    [orderId, tenantA, clientA, `loyalty-${randomUUID()}`, pendingOrderId, `loyalty-${randomUUID()}`]);
    await db.query(`INSERT INTO domain_event_outbox(event_key,event_type,coffee_shop_id,aggregate_type,aggregate_id,payload)
      VALUES($1,$2,$3,'ORDER',$4,'{}'::jsonb),($5,$2,$3,'ORDER',$4,'{}'::jsonb),($6,$2,$3,'ORDER',$7,'{}'::jsonb)`,
    [`duplicate-a-${randomUUID()}`, DomainEventTypes.OrderDelivered, tenantA, orderId,
      `duplicate-b-${randomUUID()}`, `pending-${randomUUID()}`, pendingOrderId]);
    const beforeConfigChange = await db.query(`SELECT created_at FROM domain_event_outbox WHERE aggregate_id=$1 ORDER BY created_at,id LIMIT 1`, [orderId]) as Array<{ created_at: Date }>;
    const laterProgram = await firstWorker.updateProgram(tenantA, userA,
      Object.assign(new UpdateTenantCrmLoyaltyProgramDto(), { enabled: true, spendPerPointToman: 200 }));
    assert.ok(new Date(beforeConfigChange[0]!.created_at).getTime() < new Date(laterProgram.updatedAt).getTime());

    await Promise.all([firstWorker.dispatchPendingEvents(), secondWorker.dispatchPendingEvents()]);
    await firstWorker.dispatchPendingEvents();
    const earnedRows = await db.query(`SELECT COUNT(*)::int AS count,COALESCE(SUM(points),0)::text AS points
      FROM tenant_crm_loyalty_ledger WHERE coffee_shop_id=$1 AND client_id=$2 AND entry_type='EARN' AND order_id=$3`, [tenantA, clientA, orderId]) as Array<{ count: number; points: string }>;
    assert.equal(earnedRows[0]?.count, 1);
    assert.equal(earnedRows[0]?.points, "2");
    const pendingEarn = await db.query(`SELECT COUNT(*)::int AS count FROM tenant_crm_loyalty_ledger WHERE coffee_shop_id=$1 AND client_id=$2 AND entry_type='EARN' AND order_id=$3`, [tenantA, clientA, pendingOrderId]) as Array<{ count: number }>;
    assert.equal(pendingEarn[0]?.count, 0);
    const balanceA = await firstWorker.clientLoyalty(tenantA, clientA);
    const balanceB = await firstWorker.clientLoyalty(tenantB, clientB);
    assert.equal(balanceA.balance, "22");
    assert.equal(balanceB.balance, "0");

    await firstWorker.updateProgram(tenantA, userA, Object.assign(new UpdateTenantCrmLoyaltyProgramDto(), { enabled: false, spendPerPointToman: 200 }));
    await assert.rejects(() => firstWorker.redeem(tenantA, clientA, userA,
      Object.assign(new RedeemTenantCrmRewardDto(), { rewardId: rewardA.id, idempotencyKey: `disabled-${randomUUID()}` })), ConflictException);
    await db.query(`UPDATE clients SET status='BLOCKED' WHERE coffee_shop_id=$1 AND id=$2`, [tenantA, clientA]);
    await assert.rejects(() => firstWorker.adjust(tenantA, clientA, userA, Object.assign(new AdjustTenantCrmLoyaltyDto(), {
      direction: "CREDIT" as const, points: 1, reason: "Blocked client", idempotencyKey: `blocked-${randomUUID()}`,
    })), ConflictException);
    const replayAfterBlock = await firstWorker.redeem(tenantA, clientA, userA,
      Object.assign(new RedeemTenantCrmRewardDto(), { rewardId: rewardA.id, idempotencyKey: successfulKey }));
    assert.equal(replayAfterBlock.redemption.id, replayedRedemption.redemption.id);
  } finally {
    await db.query(`DELETE FROM tenant_crm_loyalty_ledger WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM domain_event_outbox WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM tenant_crm_loyalty_redemptions WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM tenant_crm_loyalty_accounts WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM tenant_crm_loyalty_rewards WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM tenant_crm_loyalty_programs WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM orders WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM clients WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM coffee_shop_memberships WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[userA, userB]]);
    await db.query(`DELETE FROM coffee_shops WHERE id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.destroy();
  }
});
