import assert from "node:assert/strict";
import test from "node:test";
import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { CreateTenantCrmOfferDto } from "./dto/tenant-crm-offers.dto";
import { TENANT_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { TenantPermissions } from "../authorization/permission.constants";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { TenantCrmOffersController } from "./tenant-crm-offers.controller";
import { TenantCrmOffersService } from "./tenant-crm-offers.service";
import { TenantCrmSegmentsService } from "./tenant-crm-segments.service";

const tenant = "11111111-1111-4111-8111-111111111111";
const offerId = "22222222-2222-4222-8222-222222222222";
const segmentId = "33333333-3333-4333-8333-333333333333";
const promotionId = "44444444-4444-4444-8444-444444444444";

test("activation freezes the current CRM Segment audience in the same transaction", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const manager = {
    query: async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters });
      if (sql.includes("SELECT status,promotion_id AS")) return [{ status: "DRAFT", promotionId, segmentId }];
      return [];
    },
    findOne: async () => ({ isActive: true, startAt: null, endAt: null, deletedAt: null, scheduleWindows: [], coupon: null }),
  };
  const source = {
    transaction: async <T>(work: (transaction: EntityManager) => Promise<T>) => work(manager as unknown as EntityManager),
    query: async () => [{ id: offerId, status: "ACTIVE" }],
  } as unknown as DataSource;
  const segments = { audienceQuery: async (_manager: EntityManager, tenantId: string, zone: string, id: string) => {
    assert.equal(tenantId, tenant); assert.equal(zone, "Asia/Tehran"); assert.equal(id, segmentId);
    return { sql: "SELECT c.id FROM clients c WHERE c.coffee_shop_id=$1 AND c.status='ACTIVE'", parameters: [tenant], segmentName: "Active clients", criteria: { version: 1, type: "group", operator: "AND", conditions: [] } };
  } } as unknown as TenantCrmSegmentsService;
  const service = new TenantCrmOffersService(source, segments);

  await service.activate(tenant, "Asia/Tehran", offerId);

  const lock = calls.find((call) => call.sql.includes("SELECT status,promotion_id AS"));
  assert.match(lock!.sql, /FOR UPDATE/);
  const insert = calls.find((call) => call.sql.includes("WITH candidates"));
  assert.ok(insert);
  assert.match(insert.sql, /c\.coffee_shop_id=\$1/);
  assert.match(insert.sql, /INSERT INTO tenant_crm_offer_audience_members/);
  assert.deepEqual(insert.parameters, [tenant, offerId]);
  const update = calls.find((call) => call.sql.includes("SET status='ACTIVE'"));
  assert.ok(update);
  assert.deepEqual(JSON.parse(String(update.parameters[3])), { version: 1, type: "group", operator: "AND", conditions: [] });
});

test("Draft creation binds same-tenant Promotion and Segment references", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const manager = {
    query: async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters });
      return sql.includes("INSERT INTO tenant_crm_offers") ? [{ id: offerId }] : [];
    },
    findOne: async (_entity: unknown, options: { where: { id: string; coffeeShopId: string } }) => {
      assert.deepEqual(options.where, { id: promotionId, coffeeShopId: tenant });
      return { id: promotionId, coffeeShopId: tenant };
    },
  };
  const source = {
    transaction: async <T>(work: (transaction: EntityManager) => Promise<T>) => work(manager as unknown as EntityManager),
    query: async () => [{ id: offerId, status: "DRAFT" }],
  } as unknown as DataSource;
  const segments = { audienceQuery: async (_manager: EntityManager, tenantId: string, _zone: string, id: string) => {
    assert.equal(tenantId, tenant); assert.equal(id, segmentId);
    return { sql: "SELECT c.id FROM clients c WHERE c.coffee_shop_id=$1", parameters: [tenant], segmentName: "VIP", criteria: {} };
  } } as unknown as TenantCrmSegmentsService;
  const service = new TenantCrmOffersService(source, segments);
  const input = Object.assign(new CreateTenantCrmOfferDto(), { name: "  VIP offer  ", description: "", promotionId, segmentId });

  const result = await service.createDraft(tenant, "user-a", "Asia/Tehran", input);

  assert.equal(result.status, "DRAFT");
  assert.deepEqual(calls.find((call) => call.sql.includes("INSERT INTO tenant_crm_offers"))?.parameters,
    [tenant, "VIP offer", null, promotionId, segmentId, "user-a"]);
});

test("foreign tenant Offer IDs look missing and repeated activation is idempotent", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  let detailReads = 0;
  const source = {
    query: async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters });
      detailReads++;
      return detailReads === 1 ? [] : [{ id: offerId, status: "ACTIVE" }];
    },
    transaction: async <T>(work: (transaction: EntityManager) => Promise<T>) => work({
      query: async (sql: string) => { calls.push({ sql, parameters: [] }); return [{ status: "ACTIVE", promotionId, segmentId }]; },
      findOne: async () => { throw new Error("an active Offer must not revalidate or resnapshot"); },
    } as unknown as EntityManager),
  } as unknown as DataSource;
  const service = new TenantCrmOffersService(source, {} as TenantCrmSegmentsService);

  await assert.rejects(() => service.detail(tenant, offerId), NotFoundException);
  const result = await service.activate(tenant, "Asia/Tehran", offerId);

  assert.equal(result.status, "ACTIVE");
  assert.deepEqual(calls[0]?.parameters, [tenant, offerId]);
  assert.equal(calls.filter((call) => call.sql.includes("SELECT status,promotion_id AS")).length, 1);
  assert.equal(calls.some((call) => call.sql.includes("WITH candidates")), false);
});

test("Offer controller requires CRM and Discount read access and enforces tenant_crm entitlement", async () => {
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmOffersController),
    [TenantPermissions.TenantCrmRead, TenantPermissions.MenuRead]);
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmOffersController.prototype.create),
    [TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage, TenantPermissions.MenuRead]);
  let listed = false;
  const controller = new TenantCrmOffersController({ list: async () => { listed = true; return { items: [] }; } } as never,
    { requireFeature: async (_tenantId: string, feature: string) => { assert.equal(feature, SubscriptionFeatures.TenantCrm); throw new Error("feature unavailable"); } } as never);
  const request = { [TENANT_CONTEXT]: { coffeeShopId: tenant, timezone: "Asia/Tehran" }, [AUTH_PRINCIPAL]: { userId: "user-a" } } as unknown as AuthorizedRequest;
  await assert.rejects(() => controller.list(request, {} as never), /feature unavailable/);
  assert.equal(listed, false);
});
