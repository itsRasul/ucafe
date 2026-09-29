import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { TENANT_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { TenantPermissions } from "../authorization/permission.constants";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { TenantCrmSegmentsController } from "./tenant-crm-segments.controller";
import { CreateTenantCrmSegmentDto, TenantCrmSegmentListQueryDto, TenantCrmSegmentMembersQueryDto } from "./dto/tenant-crm-segments.dto";
import { TenantCrmSegmentsService } from "./tenant-crm-segments.service";

const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";
const tagA = "33333333-3333-4333-8333-333333333333";
const tagB = "44444444-4444-4444-8444-444444444444";
const fieldA = "55555555-5555-4555-8555-555555555555";
const optionA = "66666666-6666-4666-8666-666666666666";

function mockService(definitions = [{ id: fieldA, key: "office", label: "دفتر", dataType: "TEXT" }],
  options: Array<{ fieldDefinitionId: string; id: string; label: string }> = []) {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const source = {
    query: async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters });
      if (sql.includes("SELECT id,name FROM tenant_crm_tags")) return parameters[0] === tenantA ? [{ id: tagA, name: "VIP" }] : [{ id: tagB, name: "VIP" }];
      if (sql.includes("SELECT id,key,label,data_type AS")) return definitions;
      if (sql.includes("SELECT field_definition_id AS")) return options;
      if (sql.includes("COUNT(*)::text AS total")) return [{ total: "1" }];
      if (sql.includes("SELECT c.id,c.first_name")) return [{ id: "client-a", firstName: "آوا", lastName: "رضایی", phone: "+989121234567", status: "ACTIVE", createdAt: new Date("2026-09-01T00:00:00Z") }];
      return [];
    },
  } as unknown as DataSource;
  return { service: new TenantCrmSegmentsService(source), calls };
}

const criteria = (conditions: unknown[], operator: "AND" | "OR" = "AND") => ({ version: 1, type: "group", operator, conditions });
const rule = (field: string, operator: string, value?: unknown) => ({ type: "condition", field, operator, ...(value === undefined ? {} : { value }) });

test("filter metadata is an allowlist with café-local Tags and phone presence only", async () => {
  const { service, calls } = mockService();
  const fields = await service.fields(tenantA);
  assert.ok(fields.some((field) => field.key === "order.knownSpendToman"));
  assert.ok(fields.some((field) => field.key === "reservation.noShowCount"));
  assert.ok(fields.some((field) => field.key === "client.hasPhone"));
  assert.ok(fields.some((field) => field.key === "tag" && field.options[0]?.value === tagA));
  assert.ok(fields.some((field) => field.key === "custom.office"));
  assert.equal(fields.some((field) => field.key === "client.phone"), false);
  assert.ok(calls.every((call) => call.parameters[0] === tenantA));
});

test("preview compiles nested AND/OR against tenant-scoped Tags, Custom Fields, and delivered Order metrics", async () => {
  const { service, calls } = mockService();
  const result = await service.preview(tenantA, "Asia/Tehran", criteria([
    { type: "group", operator: "OR", conditions: [rule("tag", "has_tag", tagA), rule("order.knownSpendToman", "greater_or_equal", 5_000_000)] },
    rule("custom.office", "contains", "Acme"),
  ]));
  assert.equal(result.matchingClients, 1);
  assert.equal(result.sample[0]?.phone, "+989*****67");
  const query = calls.find((call) => call.sql.includes("COUNT(*)::text AS total") && call.sql.includes("FROM clients c"));
  assert.ok(query);
  assert.match(query.sql, /c\.coffee_shop_id=\$1/);
  assert.match(query.sql, /t\.coffee_shop_id=c\.coffee_shop_id AND t\.client_id=c\.id/);
  assert.match(query.sql, /o\.status='DELIVERED'/);
  assert.match(query.sql, /o\.total_amount_toman/);
  assert.match(query.sql, /tenant_crm_client_custom_field_values v/);
  assert.deepEqual(query.parameters, [tenantA, "Asia/Tehran", tagA, 5_000_000, fieldA, "Acme"]);
  assert.equal(query.sql.includes("Acme"), false);
});

test("relative dates use the café timezone and store an interval instead of a frozen date", async () => {
  const { service, calls } = mockService();
  await service.preview(tenantA, "Asia/Tehran", criteria([rule("order.lastDeliveredAt", "within_last", 30)]));
  const query = calls.find((call) => call.sql.includes("COUNT(*)::text AS total") && call.sql.includes("FROM clients c"));
  assert.ok(query);
  assert.match(query.sql, /now\(\) AT TIME ZONE \$2/);
  assert.match(query.sql, /\(\$3::int - 1\)/);
  assert.deepEqual(query.parameters, [tenantA, "Asia/Tehran", 30]);
});

test("preview and paginated members use the same tenant predicate and server-side bounds", async () => {
  const { service, calls } = mockService();
  const input = criteria([rule("order.deliveredCount", "greater_or_equal", 2)]);
  await service.preview(tenantA, "Asia/Tehran", input);
  await service.members(tenantA, "Asia/Tehran", input,
    Object.assign(new TenantCrmSegmentMembersQueryDto(), { page: 2, pageSize: 10 }));
  const counts = calls.filter((call) => call.sql.includes("COUNT(*)::text AS total") && call.sql.includes("FROM clients c"));
  assert.equal(counts.length, 2);
  assert.equal(counts[0]?.sql, counts[1]?.sql);
  assert.deepEqual(counts[0]?.parameters, [tenantA, "Asia/Tehran", 2]);
  const members = calls.find((call) => call.sql.includes("LIMIT $4 OFFSET $5"));
  assert.ok(members);
  assert.deepEqual(members.parameters, [tenantA, "Asia/Tehran", 2, 10, 10]);
});

test("Offer activation compiles the saved active Segment with its tenant predicate under a share lock", async () => {
  const segmentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const manager = { query: async (sql: string, parameters: unknown[] = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("FROM tenant_crm_segments")) return [{ id: segmentId, name: "فعال‌ها", criteria: criteria([rule("client.status", "equals", "ACTIVE")]), isActive: true }];
    if (sql.includes("SELECT id,key,label,data_type AS")) return [];
    if (sql.includes("SELECT id,name FROM tenant_crm_tags")) return [];
    return [];
  } } as unknown as EntityManager;
  const { service } = mockService();
  const audience = await service.audienceQuery(manager, tenantA, "Asia/Tehran", segmentId);
  const segmentRead = calls.find((call) => call.sql.includes("FROM tenant_crm_segments"));
  assert.match(segmentRead!.sql, /WHERE coffee_shop_id=\$1 AND id=\$2 FOR SHARE/);
  assert.match(audience.sql, /c\.coffee_shop_id=\$1/);
  assert.deepEqual(audience.parameters, [tenantA, "Asia/Tehran", "ACTIVE"]);
  assert.equal(audience.segmentName, "فعال‌ها");
});

test("delivered-value averages and phone-presence criteria use their safe source semantics", async () => {
  const { service, calls } = mockService();
  await service.preview(tenantA, "Asia/Tehran", criteria([
    rule("order.averageDeliveredValueToman", "greater_or_equal", 100),
    rule("client.hasPhone", "is_true"),
  ]));
  const query = calls.find((call) => call.sql.includes("COUNT(*)::text AS total") && call.sql.includes("FROM clients c"));
  assert.ok(query);
  assert.match(query.sql, /SUM\(o\.total_amount_toman\) FILTER \(WHERE o\.status='DELIVERED'\)/);
  assert.ok(query.sql.includes("NULLIF(BTRIM(c.phone),'') IS NOT NULL"));
});

test("typed Custom Fields compile only operators and values supported by their stored types", async () => {
  const definitions = [
    { id: fieldA, key: "text_value", label: "Text", dataType: "TEXT" },
    { id: "77777777-7777-4777-8777-777777777777", key: "number_value", label: "Number", dataType: "NUMBER" },
    { id: "88888888-8888-4888-8888-888888888888", key: "boolean_value", label: "Boolean", dataType: "BOOLEAN" },
    { id: "99999999-9999-4999-8999-999999999999", key: "date_value", label: "Date", dataType: "DATE" },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", key: "select_value", label: "Select", dataType: "SINGLE_SELECT" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", key: "multi_value", label: "Multi", dataType: "MULTI_SELECT" },
  ];
  const options = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]
    .map((fieldDefinitionId) => ({ fieldDefinitionId, id: optionA, label: "Option A" }));
  const { service, calls } = mockService(definitions, options);
  const cases = [
    ["custom.text_value", "contains", "Acme", /strpos\(lower\(COALESCE\(v\.value/],
    ["custom.number_value", "greater_or_equal", 12, /jsonb_typeof\(v\.value\)='number'.*::numeric/s],
    ["custom.boolean_value", "is_true", undefined, /IS TRUE/],
    ["custom.date_value", "before", "2026-09-01", /\$4::text/],
    ["custom.date_value", "this_month", undefined, /date_trunc\('month',now\(\) AT TIME ZONE \$2\)/],
    ["custom.select_value", "equals", optionA, /v\.value #>> '\{\}'/],
    ["custom.multi_value", "contains_any", [optionA], /v\.value \?\| \$4::text\[\]/],
    ["custom.multi_value", "contains_all", [optionA], /v\.value @> \$4::jsonb/],
  ] as const;
  for (const [field, operator, value] of cases) {
    await service.preview(tenantA, "Asia/Tehran", criteria([rule(field, operator, value)]));
  }
  const countQueries = calls.filter((call) => call.sql.includes("COUNT(*)::text AS total") && call.sql.includes("FROM clients c"));
  assert.equal(countQueries.length, cases.length);
  for (const [index, [, , , expression]] of cases.entries()) assert.match(countQueries[index]!.sql, expression);
  assert.deepEqual(countQueries.at(-1)?.parameters, [tenantA, "Asia/Tehran", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", JSON.stringify([optionA])]);
  await assert.rejects(() => service.preview(tenantA, "Asia/Tehran", criteria([rule("custom.number_value", "contains", "12")])), BadRequestException);
});

test("invalid and cross-tenant criteria are rejected before membership queries", async () => {
  const { service, calls } = mockService();
  await assert.rejects(() => service.preview(tenantA, "Asia/Tehran", criteria([rule("clients.id", "equals", "x")])), BadRequestException);
  await assert.rejects(() => service.preview(tenantA, "Asia/Tehran", criteria([rule("order.knownSpendToman", "contains", "5")])), BadRequestException);
  await assert.rejects(() => service.preview(tenantA, "Asia/Tehran", criteria([rule("tag", "has_tag", tagB)])), BadRequestException);
  await assert.rejects(() => service.preview(tenantA, "Asia/Tehran", criteria([rule("custom.other_tenant_field", "equals", "x")])), BadRequestException);
  const membersQueries = calls.filter((call) => call.sql.includes("COUNT(*)::text AS total"));
  assert.equal(membersQueries.length, 0);
});

test("stored criteria referencing an archived Custom Field remain visible and invalid", async () => {
  const storedCriteria = criteria([rule("custom.office", "contains", "Acme")]);
  const source = {
    query: async (sql: string) => {
      if (sql.includes("SELECT COUNT(*)::text AS total FROM tenant_crm_segments")) return [{ total: "1" }];
      if (sql.includes("SELECT id,name,description,criteria,is_active")) return [{
        id: "segment-a", name: "Office clients", description: null, criteria: storedCriteria, isActive: true,
        createdAt: new Date(), updatedAt: new Date(),
      }];
      return [];
    },
  } as unknown as DataSource;
  const service = new TenantCrmSegmentsService(source);
  const page = await service.list(tenantA, "Asia/Tehran", Object.assign(new TenantCrmSegmentListQueryDto(), { page: 1, pageSize: 25 }));
  assert.equal(page.items[0]?.criteriaValid, false);
  assert.ok(page.items[0]?.criteriaIssue);
  assert.deepEqual(page.items[0]?.criteria, storedCriteria);
});

test("criteria nesting and condition counts are bounded", async () => {
  const { service } = mockService();
  const nested = (depth: number): unknown => depth === 0 ? rule("client.name", "contains", "آوا")
    : { type: "group", operator: "AND", conditions: [nested(depth - 1)] };
  await assert.rejects(() => service.preview(tenantA, "Asia/Tehran", criteria([nested(3)])), BadRequestException);
  await assert.rejects(() => service.preview(tenantA, "Asia/Tehran", criteria(Array.from({ length: 21 }, () => rule("client.name", "contains", "آ")))), BadRequestException);
});

test("Segment reads are tenant-scoped and foreign IDs look missing", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const source = { query: async (sql: string, parameters: unknown[] = []) => { calls.push({ sql, parameters }); return []; } } as unknown as DataSource;
  const service = new TenantCrmSegmentsService(source);
  await assert.rejects(() => service.get(tenantA, "Asia/Tehran", tenantB), NotFoundException);
  assert.deepEqual(calls[0]?.parameters, [tenantA, tenantB]);
  assert.match(calls[0]?.sql ?? "", /WHERE coffee_shop_id=\$1 AND id=\$2/);
});

test("all segment routes retain read permission and effective tenant_crm entitlement", async () => {
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmSegmentsController), [TenantPermissions.TenantCrmRead]);
  let reachedService = false;
  const controller = new TenantCrmSegmentsController(
    { fields: async () => { reachedService = true; return []; } } as never,
    { requireFeature: async (id: string, feature: string) => { assert.equal(id, tenantA); assert.equal(feature, SubscriptionFeatures.TenantCrm); throw new Error("feature unavailable"); } } as never,
  );
  const request = { [TENANT_CONTEXT]: { coffeeShopId: tenantA, timezone: "Asia/Tehran" }, [AUTH_PRINCIPAL]: { userId: "user-a" } } as unknown as AuthorizedRequest;
  await assert.rejects(() => controller.fields(request), /feature unavailable/);
  assert.equal(reachedService, false);
});

test("the PostgreSQL query stays dynamic and excludes matching Clients from other tenants", { skip: !process.env.TENANT_CRM_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.TENANT_CRM_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error(`rollback ${randomUUID()}`);
  try {
    await assert.rejects(db.transaction(async (manager: EntityManager) => {
      const cafeA = randomUUID(), cafeB = randomUUID(), clientA = randomUUID(), clientB = randomUUID();
      const userA = randomUUID(), userB = randomUUID(), tagId = randomUUID();
      await manager.query(`INSERT INTO coffee_shops(id,name,slug,status,timezone) VALUES
        ($1,'Segment A',$2,'ACTIVE','Asia/Tehran'),($3,'Segment B',$4,'ACTIVE','Asia/Tehran')`,
      [cafeA, `seg-${cafeA.replaceAll("-", "").slice(0, 20)}`, cafeB, `seg-${cafeB.replaceAll("-", "").slice(0, 20)}`]);
      await manager.query(`INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone) VALUES
        ($1,$2,'آوا','رضایی','+989120000101'),($3,$4,'آوا','رضایی','+989120000102')`, [clientA, cafeA, clientB, cafeB]);
      await manager.query(`INSERT INTO users(id,email) VALUES($1,$2),($3,$4)`, [userA, `${userA}@segment.test`, userB, `${userB}@segment.test`]);
      await manager.query(`INSERT INTO coffee_shop_memberships(coffee_shop_id,user_id,status) VALUES($1,$2,'ACTIVE'),($3,$4,'ACTIVE')`, [cafeA,userA,cafeB,userB]);
      const tag = await manager.query<Array<{ id: string }>>(`INSERT INTO tenant_crm_tags(coffee_shop_id,name,created_by_user_id) VALUES($1,'VIP',$2) RETURNING id`, [cafeA,userA]);
      const ownTag = tag[0]!.id;
      const foreignTag = await manager.query<Array<{ id: string }>>(`INSERT INTO tenant_crm_tags(coffee_shop_id,name,created_by_user_id) VALUES($1,'VIP',$2) RETURNING id`, [cafeB,userB]);
      await manager.query(`INSERT INTO tenant_crm_client_tags(coffee_shop_id,client_id,tag_id,created_by_user_id) VALUES($1,$2,$3,$4),($5,$6,$7,$8)`,
        [cafeA,clientA,ownTag,userA,cafeB,clientB,foreignTag[0]!.id,userB]);
      const insertOrder = async (cafeId: string, clientId: string, amount: string) => manager.query(`INSERT INTO orders(
        coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,subtotal_before_discount_toman,
        discount_total_toman,order_discount_toman,idempotency_key,status_changed_at)
        VALUES($1,$2,'DELIVERED'::order_status,'OFFLINE','PICKUP',$3,$3,0,0,$4,now())`,
      [cafeId,clientId,amount,randomUUID()]);
      await insertOrder(cafeA,clientA,"80");
      await insertOrder(cafeB,clientB,"9000");

      const observedPlans: string[] = [];
      const source = { query: async (sql: string, parameters: unknown[] = []) => {
        if (sql.includes("COUNT(*)::text AS total") && sql.includes("FROM clients c") && observedPlans.length === 0) {
          const plan = await manager.query<Array<{ "QUERY PLAN": string }>>(`EXPLAIN (ANALYZE,BUFFERS,FORMAT TEXT) ${sql}`, parameters);
          observedPlans.push(...plan.map((line) => line["QUERY PLAN"]));
        }
        return manager.query(sql, parameters);
      } } as unknown as DataSource;
      const service = new TenantCrmSegmentsService(source);
      const input = Object.assign(new CreateTenantCrmSegmentDto(), { name: "VIP with known spend", criteria: criteria([
        rule("tag", "has_tag", ownTag), rule("order.knownSpendToman", "greater_or_equal", 100),
      ]) });
      const segment = await service.create(cafeA, "Asia/Tehran", userA, input) as unknown as { id: string };
      assert.equal((await service.segmentPreview(cafeA,"Asia/Tehran",segment.id)).matchingClients,0);
      await insertOrder(cafeA,clientA,"30");
      const current = await service.segmentPreview(cafeA,"Asia/Tehran",segment.id);
      assert.equal(current.matchingClients,1);
      assert.deepEqual(current.sample.map((client) => client.id),[clientA]);
      await assert.rejects(() => service.segmentPreview(cafeB,"Asia/Tehran",segment.id), NotFoundException);
      assert.ok(observedPlans.some((line) => /Scan|Execution Time/.test(line)));
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.destroy(); }
});
