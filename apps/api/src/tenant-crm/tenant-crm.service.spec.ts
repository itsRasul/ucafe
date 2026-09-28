import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { BadRequestException, NotFoundException } from "@nestjs/common";
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
import { ClientTimelineQueryDto } from "./dto/client-timeline-query.dto";
import { decodeTimelineCursor, encodeTimelineCursor } from "./timeline-cursor.util";

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
    if (sql.includes("WITH order_summary AS")) return [{ id: "client-a", firstName: "آوا", lastName: "رضایی", phone: "+989121234567", status: "ACTIVE", phoneVerifiedAt: null,
      createdAt: new Date("2026-09-01T00:00:00Z"), updatedAt: new Date("2026-09-02T00:00:00Z"), trackedOrderCount: 1, deliveredOrderCount: 1, canceledOrderCount: 0,
      knownSpendToman: "120", averageDeliveredOrderValueToman: "120", firstOrderAt: new Date("2026-09-03T00:00:00Z"), lastOrderAt: new Date("2026-09-03T00:00:00Z"),
      totalReservationCount: 0, completedReservationCount: 0, canceledReservationCount: 0, rejectedReservationCount: 0, noShowReservationCount: 0,
      firstReservationAt: null, lastReservationAt: null, lastInteractionAt: new Date("2026-09-04T00:00:00Z") }];
    if (sql.includes("FROM orders WHERE coffee_shop_id=$1 AND client_id=$2")) return [];
    if (sql.includes("FROM reservations WHERE coffee_shop_id=$1 AND client_id=$2")) return [];
    if (sql.startsWith("SELECT COUNT")) return [{ total: 1 }];
    return [{ id: "client-a", firstName: "آوا", lastName: "رضایی", phone: "+989121234567", status: "ACTIVE", createdAt: new Date() }];
  } } as unknown as DataSource;
  const service = new TenantCrmService(source);
  const query = Object.assign(new ClientDirectoryQueryDto(), { q: "آوا رضایی", page: 1, pageSize: 25 });
  await service.list("tenant-a", query);
  assert.deepEqual(calls[0]!.parameters, ["tenant-a", "%آوا رضایی%"]);
  assert.match(calls[0]!.sql, /first_name ILIKE \$2/);
  const detail = await service.detail("tenant-a", "client-a");
  assert.deepEqual(calls[2]!.parameters, ["tenant-a", "client-a"]);
  assert.match(calls[2]!.sql, /c\.id=\$2 AND c\.coffee_shop_id=\$1/);
  assert.equal(detail.phone, "+989121234567");
  assert.equal(detail.summary.orders.knownSpendToman, "120");
  assert.equal(detail.lastInteractionAt.toISOString(), "2026-09-04T00:00:00.000Z");
  assert.deepEqual(calls[3]!.parameters, ["tenant-a", "client-a"]);
  assert.deepEqual(calls[4]!.parameters, ["tenant-a", "client-a"]);
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
  await assert.rejects(() => controller.timeline(request, "client-a", new ClientTimelineQueryDto()), /feature unavailable/);
  assert.equal(listed, false);
});

test("timeline cursors round-trip a validated event key and reject malformed input", () => {
  const cursor = { occurredAt: "2026-09-04T00:00:00.000Z", eventKey: "ORDER:123e4567-e89b-12d3-a456-426614174000:STATUS:DELIVERED" };
  assert.deepEqual(decodeTimelineCursor(encodeTimelineCursor(cursor)), cursor);
  assert.throws(() => decodeTimelineCursor("%%%"), BadRequestException);
  assert.throws(() => decodeTimelineCursor(encodeTimelineCursor({ ...cursor, eventKey: "ORDER:bad:CREATED" })), BadRequestException);
});

test("timeline pages use the same strict descending tuple for ordering and cursor filtering", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const occurredAt = new Date("2026-09-04T00:00:00.000Z");
  const firstRows = [
    { eventKey: "ORDER:123e4567-e89b-12d3-a456-426614174000:STATUS:DELIVERED", type: "ORDER_COMPLETED", occurredAt, sourceType: "ORDER", sourceId: "123e4567-e89b-12d3-a456-426614174000", metadata: { status: "DELIVERED" } },
    { eventKey: "ORDER:123e4567-e89b-12d3-a456-426614174000:CREATED", type: "ORDER_CREATED", occurredAt, sourceType: "ORDER", sourceId: "123e4567-e89b-12d3-a456-426614174000", metadata: { totalAmountToman: "50", deliveryMethod: "PICKUP" } },
    { eventKey: "CLIENT:123e4567-e89b-12d3-a456-426614174001:CREATED", type: "CLIENT_CREATED", occurredAt: new Date("2026-09-03T00:00:00.000Z"), sourceType: "CLIENT", sourceId: "123e4567-e89b-12d3-a456-426614174001", metadata: {} },
  ];
  const source = { query: async (sql: string, parameters: unknown[]) => {
    calls.push({ sql, parameters });
    if (sql.startsWith("SELECT id FROM clients")) return [{ id: "client-a" }];
    return calls.filter((call) => call.sql.startsWith("\n  SELECT event_key" )).length === 1 ? firstRows : [];
  } } as unknown as DataSource;
  const service = new TenantCrmService(source);
  const query = Object.assign(new ClientTimelineQueryDto(), { pageSize: 2 });
  const first = await service.timeline("tenant-a", "client-a", query);
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const pageQuery = calls.find((call) => call.sql.startsWith("\n  SELECT event_key"))!;
  assert.deepEqual(pageQuery.parameters, ["tenant-a", "client-a", 3]);
  assert.match(pageQuery.sql, /ORDER BY occurred_at DESC,event_key DESC/);
  assert.equal(new Set(firstRows.slice(0, 2).map((row) => row.eventKey)).size, 2);

  await service.timeline("tenant-a", "client-a", Object.assign(new ClientTimelineQueryDto(), { pageSize: 2, cursor: first.nextCursor! }));
  const pageTwo = calls.filter((call) => call.sql.startsWith("\n  SELECT event_key"))[1]!;
  const cursor = decodeTimelineCursor(first.nextCursor!);
  assert.deepEqual(pageTwo.parameters, ["tenant-a", "client-a", cursor!.occurredAt, cursor!.eventKey, 3]);
  assert.match(pageTwo.sql, /\(occurred_at,event_key\) < \(\$3::timestamptz,\$4::text\)/);
  assert.match(pageTwo.sql, /ORDER BY occurred_at DESC,event_key DESC/);
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

test("Customer 360 metrics and reconstructed timeline use only the current tenant sources", { skip: !process.env.TENANT_CRM_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.TENANT_CRM_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error(`rollback ${randomUUID()}`);
  try {
    await assert.rejects(db.transaction(async (manager: EntityManager) => {
      const tenantA = randomUUID(), tenantB = randomUUID(), branchA = randomUUID(), branchB = randomUUID();
      const clientA = randomUUID(), clientB = randomUUID(), clientC = randomUUID();
      await manager.query(`INSERT INTO coffee_shops(id,name,slug,status,timezone) VALUES($1,'CRM fixture A',$2,'ACTIVE','Asia/Tehran'),($3,'CRM fixture B',$4,'ACTIVE','Asia/Tehran')`,
        [tenantA, `crm-${tenantA.replaceAll("-", "").slice(0, 20)}`, tenantB, `crm-${tenantB.replaceAll("-", "").slice(0, 20)}`]);
      await manager.query(`INSERT INTO branches(id,coffee_shop_id,name,slug,is_primary,timezone) VALUES($1,$2,'Main','main',true,'Asia/Tehran'),($3,$4,'Main','main',true,'Asia/Tehran')`, [branchA,tenantA,branchB,tenantB]);
      await manager.query(`INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone,created_at) VALUES
        ($1,$2,'آوا','رضایی','+989120000001',$3),($4,$5,'آوا','رضایی','+989120000001',$3),($6,$2,'مشتری','بدون سفارش','+989120000002','2026-01-02T00:00:00Z')`,
        [clientA,tenantA,"2026-01-01T00:00:00Z",clientB,tenantB,clientC]);
      const addOrder = (tenant: string, client: string, status: string, amount: string, created: string, changed: string | null) => manager.query(
        `INSERT INTO orders(coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,subtotal_before_discount_toman,discount_total_toman,order_discount_toman,idempotency_key,created_at,status_changed_at)
         VALUES($1,$2,$3::order_status,'OFFLINE','PICKUP',$4,$4,0,0,$5,$6,$7)`, [tenant,client,status,amount,randomUUID(),created,changed]);
      await addOrder(tenantA,clientA,"DELIVERED","10","2026-01-01T00:00:00Z","2026-01-01T00:00:00Z");
      await addOrder(tenantA,clientA,"DELIVERED","11","2026-01-03T00:00:00Z","2026-01-08T00:00:00Z");
      await addOrder(tenantA,clientA,"CANCELED","900","2026-01-04T00:00:00Z","2026-01-09T00:00:00Z");
      await addOrder(tenantA,clientA,"UNDER_REVIEW","400","2026-01-05T00:00:00Z",null);
      await addOrder(tenantB,clientB,"DELIVERED","9999","2026-01-12T00:00:00Z","2026-01-12T00:00:00Z");
      const addReservation = (tenant: string, branch: string, client: string, status: string, created: string, changed: string | null) => manager.query(
        `INSERT INTO reservations(coffee_shop_id,branch_id,client_id,contact_name,reservation_date,start_time,end_time,party_size,status,created_at,status_changed_at)
         VALUES($1,$2,$3,'آوا رضایی','2026-01-15','18:00','19:30',$4,$5::reservation_status,$6,$7)`,
        [tenant,branch,client,2,status,created,changed]);
      await addReservation(tenantA,branchA,clientA,"COMPLETED","2026-01-04T00:00:00Z","2026-01-06T00:00:00Z");
      await addReservation(tenantA,branchA,clientA,"CANCELED","2026-01-05T00:00:00Z","2026-01-07T00:00:00Z");
      await addReservation(tenantA,branchA,clientA,"REJECTED","2026-01-06T00:00:00Z","2026-01-08T00:00:00Z");
      await addReservation(tenantA,branchA,clientA,"NO_SHOW","2026-01-07T00:00:00Z","2026-01-09T00:00:00Z");
      await addReservation(tenantA,branchA,clientA,"PENDING","2026-01-10T00:00:00Z",null);
      await addReservation(tenantB,branchB,clientB,"CONFIRMED","2026-01-12T00:00:00Z","2026-01-12T00:00:00Z");

      const plans: Array<{ label: string; lines: string[] }> = [];
      const source = { query: async (sql: string, parameters: unknown[]) => {
        const label = sql.includes("WITH order_summary AS") ? "Customer 360 summary"
          : sql.includes("FROM orders WHERE coffee_shop_id=$1 AND client_id=$2 ORDER BY created_at DESC") ? "Recent Orders"
            : sql.includes("FROM reservations WHERE coffee_shop_id=$1 AND client_id=$2 ORDER BY created_at DESC") ? "Recent Reservations"
              : sql.includes("SELECT event_key AS") ? sql.includes("AND (occurred_at,event_key)") ? "Timeline cursor page" : "Timeline first page" : "";
        if (label && !plans.some((plan) => plan.label === label)) {
          const result = await manager.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT TEXT) ${sql}`, parameters) as Array<{ "QUERY PLAN": string }>;
          plans.push({ label, lines: result.map((row) => row["QUERY PLAN"]) });
        }
        return manager.query(sql, parameters);
      } } as unknown as DataSource;
      const service = new TenantCrmService(source);
      const detail = await service.detail(tenantA,clientA);
      assert.equal(detail.summary.orders.trackedCount,4);
      assert.equal(detail.summary.orders.deliveredCount,2);
      assert.equal(detail.summary.orders.canceledCount,1);
      assert.equal(detail.summary.orders.knownSpendToman,"21");
      assert.equal(detail.summary.orders.averageDeliveredOrderValueToman,"11");
      assert.equal(detail.summary.orders.firstOrderAt?.toISOString(),"2026-01-01T00:00:00.000Z");
      assert.equal(detail.summary.orders.lastOrderAt?.toISOString(),"2026-01-05T00:00:00.000Z");
      assert.deepEqual(detail.summary.reservations, { totalCount:5,completedCount:1,canceledCount:1,rejectedCount:1,noShowCount:1,
        firstReservationAt:new Date("2026-01-04T00:00:00Z"),lastReservationAt:new Date("2026-01-10T00:00:00Z") });
      assert.equal(detail.firstSeenAt.toISOString(),"2026-01-01T00:00:00.000Z");
      assert.equal(detail.lastInteractionAt.toISOString(),"2026-01-10T00:00:00.000Z");
      assert.deepEqual(detail.recentOrders.map((order) => order.totalAmountToman),["400","900","11","10"]);
      assert.equal(detail.recentReservations.length,5);
      const noActivity = await service.detail(tenantA,clientC);
      assert.equal(noActivity.summary.orders.knownSpendToman,"0");
      assert.equal(noActivity.summary.orders.averageDeliveredOrderValueToman,null);
      assert.equal(noActivity.lastInteractionAt.toISOString(),"2026-01-02T00:00:00.000Z");
      await assert.rejects(() => service.detail(tenantA,clientB),NotFoundException);
      await assert.rejects(() => service.timeline(tenantA,clientB,new ClientTimelineQueryDto()),NotFoundException);

      const events: Array<{ eventKey: string; type: string; occurredAt: Date; sourceType: string; sourceId: string }> = [];
      let cursor: string | undefined;
      do {
        const page = await service.timeline(tenantA,clientA,Object.assign(new ClientTimelineQueryDto(),{ pageSize:2,cursor }));
        events.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      assert.equal(events.length,17);
      assert.equal(new Set(events.map((event) => event.eventKey)).size,events.length);
      assert.equal(events.some((event) => event.type === "ORDER_COMPLETED"),true);
      assert.equal(events.some((event) => event.type === "RESERVATION_NO_SHOW"),true);
      assert.equal(events.some((event) => event.sourceId === clientB),false);
      for (let index = 1; index < events.length; index++) {
        const previous = events[index - 1]!;
        const current = events[index]!;
        assert.ok(previous.occurredAt > current.occurredAt || previous.occurredAt.getTime() === current.occurredAt.getTime() && previous.eventKey > current.eventKey);
      }
      console.log(plans.map((plan) => `${plan.label}: ${plan.lines.filter((line) => /Seq Scan|Index Scan|Sort Method|Execution Time/.test(line)).join("; ")}`).join("\n"));
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
