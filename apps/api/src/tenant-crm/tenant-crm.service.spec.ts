import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { NotFoundException } from "@nestjs/common";
import "reflect-metadata";
import { TENANT_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { TenantPermissions } from "../authorization/permission.constants";
import { SubscriptionPlan } from "../subscriptions/entities";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { TenantCrmDirectory1790590000000 } from "../database/migrations/1790590000000-TenantCrmDirectory";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { TenantCrmController } from "./tenant-crm.controller";
import { TenantCrmService } from "./tenant-crm.service";
import { ClientDirectoryQueryDto } from "./dto/client-directory-query.dto";

test("directory scopes SQL to the tenant, normalizes Iranian phone, masks list phones, and paginates", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const source = { query: async (sql: string, parameters: unknown[]) => {
    calls.push({ sql, parameters });
    return sql.startsWith("SELECT COUNT") ? [{ total: 1 }] : [{ id: "client-a", firstName: "آوا", lastName: "رضایی", phone: "+989121234567", status: "ACTIVE", createdAt: new Date("2026-09-01T00:00:00Z") }];
  } } as unknown as DataSource;
  const service = new TenantCrmService(source);
  const query = Object.assign(new ClientDirectoryQueryDto(), { q: "۰۹۱۲۱۲۳۴۵۶۷", status: "ACTIVE" as const, sortBy: "name" as const, sortOrder: "asc" as const, page: 2, pageSize: 10 });
  const result = await service.list("tenant-a", query);
  assert.match(calls[0]!.sql, /coffee_shop_id=\$1 AND status=\$2 AND phone=\$3/);
  assert.deepEqual(calls[0]!.parameters, ["tenant-a", "ACTIVE", "+989121234567"]);
  assert.match(calls[1]!.sql, /ORDER BY lower\(first_name \|\| ' ' \|\| last_name\) ASC, id ASC/);
  assert.match(calls[1]!.sql, /coffee_shop_id=\$1/);
  assert.deepEqual(calls[1]!.parameters, ["tenant-a", "ACTIVE", "+989121234567", 10, 10]);
  assert.equal(result.items[0]!.phone, "+989*****67");
  assert.equal(result.total, 1);
});

test("name search is parameterized and detail lookup includes tenant scope", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const source = { query: async (sql: string, parameters: unknown[]) => {
    calls.push({ sql, parameters });
    if (sql.includes("phone_verified_at")) return [{ id: "client-a", firstName: "آوا", lastName: "رضایی", phone: "+989121234567", status: "ACTIVE", phoneVerifiedAt: null, createdAt: new Date(), updatedAt: new Date() }];
    if (sql.startsWith("SELECT COUNT")) return [{ total: 1 }];
    return [{ id: "client-a", firstName: "آوا", lastName: "رضایی", phone: "+989121234567", status: "ACTIVE", createdAt: new Date() }];
  } } as unknown as DataSource;
  const service = new TenantCrmService(source);
  const query = Object.assign(new ClientDirectoryQueryDto(), { q: "آوا رضایی", page: 1, pageSize: 25 });
  await service.list("tenant-a", query);
  assert.deepEqual(calls[0]!.parameters, ["tenant-a", "%آوا رضایی%"]);
  assert.match(calls[0]!.sql, /first_name ILIKE \$2/);
  const detail = await service.detail("tenant-a", "client-a");
  assert.deepEqual(calls[2]!.parameters, ["client-a", "tenant-a"]);
  assert.match(calls[2]!.sql, /id=\$1 AND coffee_shop_id=\$2/);
  assert.equal(detail.phone, "+989121234567");
});

test("foreign tenant detail is indistinguishable from missing Client", async () => {
  const service = new TenantCrmService({ query: async () => [] } as unknown as DataSource);
  await assert.rejects(() => service.detail("tenant-a", randomUUID()), NotFoundException);
});

test("CRM controller requires tenant_crm.read and checks entitlement before listing", async () => {
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmController), [TenantPermissions.TenantCrmRead]);
  let listed = false;
  const controller = new TenantCrmController(
    { list: async () => { listed = true; return { items: [], total: 0, page: 1, pageSize: 25 }; } } as never,
    { requireFeature: async (_tenantId: string, feature: string) => { assert.equal(feature, SubscriptionFeatures.TenantCrm); throw new Error("feature unavailable"); } } as never,
  );
  const request = { [TENANT_CONTEXT]: { coffeeShopId: "tenant-a" }, [AUTH_PRINCIPAL]: { userId: "user-a", sessionId: "session-a" } } as unknown as AuthorizedRequest;
  await assert.rejects(() => controller.list(request, new ClientDirectoryQueryDto()), /feature unavailable/);
  assert.equal(listed, false);
});

test("same normalized phone belongs independently to each café and foreign details stay hidden", { skip: !process.env.TENANT_CRM_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.TENANT_CRM_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error(`rollback ${randomUUID()}`);
  try {
    await assert.rejects(db.transaction(async (manager: EntityManager) => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      const clientA = randomUUID();
      const clientB = randomUUID();
      await manager.query(`INSERT INTO coffee_shops(id,name,slug) VALUES ($1,'CRM test A',$2),($3,'CRM test B',$4)`, [tenantA, `crm-${tenantA.replaceAll("-", "").slice(0, 20)}`, tenantB, `crm-${tenantB.replaceAll("-", "").slice(0, 20)}`]);
      await manager.query(`INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone) VALUES ($1,$2,'آوا','رضایی','+989121234567'),($3,$4,'آوا','رضایی','+989121234567')`, [clientA, tenantA, clientB, tenantB]);
      const service = new TenantCrmService({ query: manager.query.bind(manager) } as unknown as DataSource);
      const query = Object.assign(new ClientDirectoryQueryDto(), { q: "09121234567", page: 1, pageSize: 10 });
      const onlyA = await service.list(tenantA, query);
      assert.deepEqual(onlyA.items.map((client) => client.id), [clientA]);
      assert.equal(onlyA.items[0]!.phone, "+989*****67");
      await assert.rejects(() => service.detail(tenantA, clientB), NotFoundException);
      await assert.rejects(manager.query(`INSERT INTO clients(coffee_shop_id,first_name,last_name,phone) VALUES ($1,'دوباره','مشتری','+989121234567')`, [tenantA]));
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.destroy(); }
});

test("tenant_crm defaults on Golden and remains editable on any plan", { skip: !process.env.TENANT_CRM_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.TENANT_CRM_INTEGRATION_DATABASE_URL, entities: [SubscriptionPlan] });
  await db.initialize();
  const runner = db.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`UPDATE subscription_plans SET features=features-'tenant_crm' WHERE key IN ('golden','silver')`);
    await new TenantCrmDirectory1790590000000().up(runner);
    const plans = runner.manager.getRepository(SubscriptionPlan);
    assert.equal((await plans.findOneByOrFail({ key: "golden" })).features.tenant_crm, true);
    assert.equal((await plans.findOneByOrFail({ key: "silver" })).features.tenant_crm, false);
    await runner.query(`UPDATE subscription_plans SET features=jsonb_set(features,'{tenant_crm}','true'::jsonb) WHERE key='silver'`);
    await new TenantCrmDirectory1790590000000().up(runner);
    assert.equal((await plans.findOneByOrFail({ key: "silver" })).features.tenant_crm, true);
    const permissions = await runner.query(`SELECT COUNT(*)::int AS total FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.scope='TENANT' AND r.key='owner' AND p.key='tenant_crm.read'`);
    assert.equal(permissions[0]!.total > 0, true);
    const service = new SubscriptionsService({ getRepository: (entity: typeof SubscriptionPlan) => runner.manager.getRepository(entity) } as never, {} as never);
    await service.updatePlan("golden", { features: { tenant_crm: false } });
    assert.equal((await plans.findOneByOrFail({ key: "golden" })).features.tenant_crm, false);
    await service.updatePlan("silver", { features: { tenant_crm: true } });
    assert.equal((await plans.findOneByOrFail({ key: "silver" })).features.tenant_crm, true);
    await service.updatePlan("silver", { features: { tenant_crm: false } });
    assert.equal((await plans.findOneByOrFail({ key: "silver" })).features.tenant_crm, false);
  } finally { await runner.rollbackTransaction(); await runner.release(); await db.destroy(); }
});
