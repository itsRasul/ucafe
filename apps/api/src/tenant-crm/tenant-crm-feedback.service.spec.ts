import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { DataSource, EntityManager } from "typeorm";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { TENANT_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { AUTH_PRINCIPAL } from "../authorization/auth-principal";
import { TenantPermissions } from "../authorization/permission.constants";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { ClientAccessTokenGuard } from "../clients/client-access-token.guard";
import { CLIENT_PRINCIPAL } from "../clients/client-principal";
import { TenantCrmFeedbackController, TenantCrmClientFeedbackController } from "./tenant-crm-feedback.controller";
import { CreateTenantCrmFeedbackDto, SubmitTenantCrmFeedbackDto, TenantCrmFeedbackListQueryDto } from "./dto/tenant-crm-feedback.dto";
import { CreateTenantCrmReminderDto } from "./dto/tenant-crm-phase3.dto";
import { TenantCrmService } from "./tenant-crm.service";
import { ClientTimelineQueryDto } from "./dto/client-timeline-query.dto";
import { decodeTimelineCursor, encodeTimelineCursor } from "./timeline-cursor.util";

const tenantId = randomUUID();
const clientId = randomUUID();
const actorId = randomUUID();
const feedbackId = randomUUID();

function feedbackRow(overrides: Record<string, unknown> = {}) {
  return { id: feedbackId, clientId, clientFirstName: "آوا", clientLastName: "رضایی", phone: "+989121234567", rating: 2,
    comment: "Late order", source: "MANUAL", status: "NEEDS_ATTENTION", orderId: null, orderStatus: null, reservationId: null,
    reservationStatus: null, reservationDate: null, reservationStartTime: null, createdByUserId: actorId, resolvedByUserId: null,
    resolutionNote: null, resolvedAt: null, createdAt: new Date("2026-09-01T10:00:00Z"), updatedAt: new Date("2026-09-01T10:00:00Z"), ...overrides };
}

function transactionalSource(query: (sql: string, parameters: unknown[]) => Promise<unknown>) {
  const manager = { query } as unknown as EntityManager;
  return { query, transaction: (work: (manager: EntityManager) => Promise<unknown>) => work(manager) } as unknown as DataSource;
}

test("feedback DTOs validate rating bounds, required ratings, and trimmed comments", async () => {
  const valid = plainToInstance(CreateTenantCrmFeedbackDto, { clientId, rating: "5", comment: "  Good  " });
  assert.equal(valid.rating, 5);
  assert.equal(valid.comment, "Good");
  assert.deepEqual(await validate(valid), []);
  const invalid = plainToInstance(CreateTenantCrmFeedbackDto, { clientId, rating: 6 });
  assert.ok((await validate(invalid)).some((error) => error.property === "rating"));
  assert.ok((await validate(plainToInstance(CreateTenantCrmFeedbackDto, { clientId, comment: "Only text" }))).some((error) => error.property === "rating"));
});

test("manual low ratings enter Needs Attention while rating three stays New", async () => {
  for (const [rating, status] of [[2, "NEEDS_ATTENTION"], [3, "NEW"]] as const) {
    const statements: Array<{ sql: string; parameters: unknown[] }> = [];
    const source = transactionalSource(async (sql, parameters) => {
      statements.push({ sql, parameters });
      if (sql.startsWith("SELECT id FROM clients")) return [{ id: clientId }];
      if (sql.startsWith("INSERT INTO tenant_crm_feedback")) return [{ id: feedbackId }];
      if (sql.startsWith("INSERT INTO domain_event_outbox")) return [];
      if (sql.includes("FROM tenant_crm_feedback f JOIN clients")) return [feedbackRow({ rating, status, comment: "Staff report" })];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const result = await new TenantCrmService(source).createFeedback(tenantId, actorId,
      Object.assign(new CreateTenantCrmFeedbackDto(), { clientId, rating, comment: "  Staff report  " }));
    assert.equal((result as unknown as Record<string, unknown>).status, status);
    const insert = statements.find(({ sql }) => sql.startsWith("INSERT INTO tenant_crm_feedback"))!;
    assert.match(insert.sql, /coffee_shop_id,client_id,rating,comment,source,order_id,reservation_id,status,created_by_user_id/);
    assert.deepEqual(insert.parameters, [tenantId, clientId, rating, "Staff report", "MANUAL", null, null, status, actorId]);
    const event = statements.find(({ sql }) => sql.startsWith("INSERT INTO domain_event_outbox"))!;
    assert.equal(event.parameters[0], `feedback-created:${feedbackId}`);
    assert.equal(event.parameters[1], "tenant.crm.feedback.created");
    assert.equal(event.parameters[5], rating);
    assert.equal(result.phone, "+989*****67");
  }
});

test("customer submissions require one completed same-client source and hide foreign IDs", async () => {
  const orderId = randomUUID();
  const queries: Array<{ sql: string; parameters: unknown[] }> = [];
  const source = transactionalSource(async (sql, parameters) => {
    queries.push({ sql, parameters });
    if (sql.startsWith("SELECT id FROM clients")) return [{ id: clientId }];
    if (sql.startsWith("SELECT status FROM orders")) return [{ status: "DELIVERED" }];
    if (sql.startsWith("INSERT INTO tenant_crm_feedback")) return [{ id: feedbackId }];
    if (sql.startsWith("INSERT INTO domain_event_outbox")) return [];
    if (sql.includes("FROM tenant_crm_feedback f JOIN clients")) return [feedbackRow({ source: "CUSTOMER_PANEL", status: "NEW", orderId })];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const service = new TenantCrmService(source);
  await service.submitClientFeedback(tenantId, clientId, Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 3, orderId }));
  const orderLookup = queries.find(({ sql }) => sql.startsWith("SELECT status FROM orders"))!;
  assert.match(orderLookup.sql, /coffee_shop_id=\$1 AND id=\$2 AND client_id=\$3/);
  assert.deepEqual(orderLookup.parameters, [tenantId, orderId, clientId]);
  const insert = queries.find(({ sql }) => sql.startsWith("INSERT INTO tenant_crm_feedback"))!;
  assert.equal(insert.parameters[4], "CUSTOMER_PANEL");
  assert.equal(insert.parameters[5], orderId);
  assert.equal(insert.parameters[8], null);

  const reservationId = randomUUID();
  const reservationSource = transactionalSource(async (sql, parameters) => {
    if (sql.startsWith("SELECT id FROM clients")) return [{ id: clientId }];
    if (sql.startsWith("SELECT status FROM reservations")) return [{ status: "COMPLETED" }];
    if (sql.startsWith("INSERT INTO tenant_crm_feedback")) return [{ id: feedbackId }];
    if (sql.startsWith("INSERT INTO domain_event_outbox")) return [];
    if (sql.includes("FROM tenant_crm_feedback f JOIN clients")) return [feedbackRow({ source: "CUSTOMER_PANEL", status: "NEW", reservationId })];
    throw new Error(`Unexpected query: ${sql} ${JSON.stringify(parameters)}`);
  });
  await new TenantCrmService(reservationSource).submitClientFeedback(tenantId, clientId,
    Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 4, reservationId }));

  const unfinishedSource = transactionalSource(async (sql) => {
    if (sql.startsWith("SELECT id FROM clients")) return [{ id: clientId }];
    if (sql.startsWith("SELECT status FROM orders")) return [{ status: "PROCESSING" }];
    throw new Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(() => new TenantCrmService(unfinishedSource).submitClientFeedback(tenantId, clientId,
    Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 5, orderId })), BadRequestException);

  await assert.rejects(() => service.submitClientFeedback(tenantId, clientId, Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 5 })), BadRequestException);
  await assert.rejects(() => service.submitClientFeedback(tenantId, clientId, Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 5, orderId, reservationId: randomUUID() })), BadRequestException);

  const wrongClientSource = transactionalSource(async (sql) => {
    if (sql.startsWith("SELECT id FROM clients")) return [{ id: clientId }];
    if (sql.startsWith("SELECT status FROM orders")) return [];
    throw new Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(() => new TenantCrmService(wrongClientSource).submitClientFeedback(tenantId, clientId,
    Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 4, orderId })), NotFoundException);
});

test("feedback list uses tenant scoped filters, allowlisted sort and database pagination", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const source = { query: async (sql: string, parameters: unknown[]) => {
    calls.push({ sql, parameters });
    if (sql.startsWith("SELECT id FROM clients")) return [{ id: clientId }];
    if (sql.startsWith("SELECT COUNT")) return [{ total: "1" }];
    return [feedbackRow({ phone: "+989*****67" })];
  } } as unknown as DataSource;
  const query = Object.assign(new TenantCrmFeedbackListQueryDto(), { clientId, status: "NEEDS_ATTENTION" as const, rating: 2,
    source: "MANUAL" as const, dateFrom: "2026-09-01", dateTo: "2026-09-30", sortBy: "rating" as const,
    sortOrder: "asc" as const, page: 2, pageSize: 10 });
  const result = await new TenantCrmService(source).listFeedback(tenantId, query, "Asia/Tehran");
  assert.equal(result.total, 1);
  const countCall = calls.find(({ sql }) => sql.startsWith("SELECT COUNT"))!;
  const listCall = calls.find(({ sql }) => sql.includes("LEFT JOIN orders o"))!;
  assert.match(countCall.sql, /f\.coffee_shop_id=\$1 AND f\.client_id=\$2 AND f\.status=\$3 AND f\.rating=\$4 AND f\.source=\$5/);
  assert.match(listCall.sql, /ORDER BY f\.rating ASC,f\.id DESC LIMIT \$9 OFFSET \$10/);
  assert.match(listCall.sql, /created_at >= \(\$7::date::timestamp AT TIME ZONE \$6\)/);
  assert.deepEqual(listCall.parameters, [tenantId, clientId, "NEEDS_ATTENTION", 2, "MANUAL", "Asia/Tehran", "2026-09-01", "2026-09-30", 10, 10]);
});

test("public customer feedback lookup returns only the current client's response fields", async () => {
  let sql = "";
  let parameters: unknown[] = [];
  const orderId = randomUUID();
  const service = new TenantCrmService({ query: async (query: string, values: unknown[]) => {
    sql = query;
    parameters = values;
    return [{ id: feedbackId, rating: 5, comment: "Great", source: "CUSTOMER_PANEL", createdAt: new Date() }];
  } } as unknown as DataSource);
  const result = await service.clientFeedbackForOrder(tenantId, clientId, orderId);
  assert.deepEqual(parameters, [tenantId, clientId, orderId]);
  assert.match(sql, /WHERE coffee_shop_id=\$1 AND client_id=\$2 AND order_id=\$3 AND source='CUSTOMER_PANEL'/);
  assert.doesNotMatch(sql, /status|resolution_note|resolved_by_user_id|created_by_user_id/);
  assert.equal("status" in (result as object), false);
});

test("service recovery locks state, records one resolution, and rejects reopening", async () => {
  let status = "NEW";
  let resolution: Record<string, unknown> = {};
  const updates: string[] = [];
  const events: Array<{ sql: string; parameters: unknown[] }> = [];
  const source = transactionalSource(async (sql, parameters) => {
    if (sql.includes("SELECT status,")) return [{ status, clientId, rating: 2, source: "MANUAL" }];
    if (sql.startsWith("INSERT INTO domain_event_outbox")) { events.push({ sql, parameters }); return []; }
    if (sql.startsWith("UPDATE tenant_crm_feedback")) {
      updates.push(sql);
      if (sql.includes("status='NEEDS_ATTENTION'")) status = "NEEDS_ATTENTION";
      else {
        status = "RESOLVED";
        resolution = { resolvedByUserId: parameters[2], resolutionNote: parameters[3], resolvedAt: new Date("2026-09-02T00:00:00Z") };
      }
      return [];
    }
    if (sql.startsWith("INSERT INTO domain_event_outbox")) return [];
    if (sql.includes("FROM tenant_crm_feedback f JOIN clients")) return [feedbackRow({ status, ...resolution })];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const service = new TenantCrmService(source);
  const attention = await service.markFeedbackNeedsAttention(tenantId, feedbackId);
  assert.equal((attention as unknown as Record<string, unknown>).status, "NEEDS_ATTENTION");
  assert.match(updates[0]!, /status='NEEDS_ATTENTION'/);
  const resolved = await service.resolveFeedback(tenantId, actorId, feedbackId, { resolutionNote: "  Called and refunded  " });
  const resolvedRecord = resolved as unknown as Record<string, unknown>;
  assert.equal(resolvedRecord.status, "RESOLVED");
  assert.equal((resolvedRecord.resolvedAt as Date).toISOString(), "2026-09-02T00:00:00.000Z");
  assert.equal(resolvedRecord.resolvedByUserId, actorId);
  assert.equal(resolvedRecord.resolutionNote, "Called and refunded");
  assert.equal(events.length, 1);
  assert.equal(events[0]!.parameters[1], "tenant.crm.feedback.resolved");
  const updateCount = updates.length;
  await service.resolveFeedback(tenantId, actorId, feedbackId, { resolutionNote: "Replacement note" });
  assert.equal(updates.length, updateCount);
  await assert.rejects(() => service.markFeedbackNeedsAttention(tenantId, feedbackId), ConflictException);
  assert.ok(updates.every((sql) => sql.includes("coffee_shop_id=\$1 AND id=\$2")));
});

test("Customer 360 summary and recent feedback are tenant scoped and bounded", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const overview = { id: clientId, firstName: "آوا", lastName: "رضایی", phone: "+989121234567", status: "ACTIVE", phoneVerifiedAt: null,
    createdAt: new Date("2026-08-01T00:00:00Z"), updatedAt: new Date("2026-08-01T00:00:00Z"), trackedOrderCount: 0,
    deliveredOrderCount: 0, canceledOrderCount: 0, knownSpendToman: "0", averageDeliveredOrderValueToman: null, firstOrderAt: null,
    lastOrderAt: null, totalReservationCount: 0, completedReservationCount: 0, canceledReservationCount: 0, rejectedReservationCount: 0,
    noShowReservationCount: 0, firstReservationAt: null, lastReservationAt: null, lastInteractionAt: new Date("2026-08-01T00:00:00Z"),
    feedbackCount: 4, averageFeedbackRating: "3.8", negativeFeedbackCount: 1, needsAttentionFeedbackCount: 1, lastFeedbackAt: new Date("2026-09-01T00:00:00Z") };
  const source = { query: async (sql: string, parameters: unknown[]) => {
    calls.push({ sql, parameters });
    if (sql.includes("WITH order_summary AS")) return [overview];
    if (sql.includes("FROM tenant_crm_feedback WHERE coffee_shop_id=$1 AND client_id=$2 ORDER BY")) return [feedbackRow({ orderId: randomUUID() })];
    return [];
  } } as unknown as DataSource;
  const detail = await new TenantCrmService(source).detail(tenantId, clientId);
  assert.deepEqual(detail.summary.feedback, { count: 4, averageRating: "3.8", negativeCount: 1, needsAttentionCount: 1, lastFeedbackAt: overview.lastFeedbackAt });
  assert.equal(detail.recentFeedback.length, 1);
  const summaryQuery = calls.find(({ sql }) => sql.includes("WITH order_summary AS"))!;
  assert.match(summaryQuery.sql, /tenant_crm_feedback WHERE coffee_shop_id=\$1 AND client_id=\$2/);
  const recentQuery = calls.find(({ sql }) => sql.includes("FROM tenant_crm_feedback WHERE coffee_shop_id=$1 AND client_id=$2 ORDER BY"))!;
  assert.match(recentQuery.sql, /ORDER BY created_at DESC,id DESC LIMIT 5/);
  assert.deepEqual(recentQuery.parameters, [tenantId, clientId]);
});

test("feedback timeline event cursors round trip and stay in the stable event grammar", async () => {
  const eventKey = `FEEDBACK:${feedbackId}:RESOLVED`;
  const cursor = { occurredAt: "2026-09-01T10:00:00.000Z", eventKey };
  assert.deepEqual(decodeTimelineCursor(encodeTimelineCursor(cursor)), cursor);
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const service = new TenantCrmService({ query: async (sql: string, parameters: unknown[]) => {
    calls.push({ sql, parameters });
    if (sql.startsWith("SELECT id FROM clients")) return [{ id: clientId }];
    return [{ eventKey, type: "FEEDBACK_RESOLVED", occurredAt: new Date(cursor.occurredAt), sourceType: "FEEDBACK", sourceId: feedbackId, metadata: { rating: 2, source: "MANUAL" } }];
  } } as unknown as DataSource);
  const page = await service.timeline(tenantId, clientId, Object.assign(new ClientTimelineQueryDto(), { pageSize: 1 }));
  assert.equal(page.items[0]!.type, "FEEDBACK_RESOLVED");
  assert.match(calls[1]!.sql, /FROM tenant_crm_feedback f WHERE f\.coffee_shop_id=\$1 AND f\.client_id=\$2/);
  assert.equal(page.nextCursor, null);
});

test("feedback routes retain Tenant CRM permissions, feature gating, and authenticated Client identity", async () => {
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmFeedbackController), [TenantPermissions.TenantCrmRead]);
  for (const method of ["create", "needsAttention", "resolve"] as const) {
    assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmFeedbackController.prototype[method]),
      [TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage]);
  }
  assert.ok((Reflect.getMetadata(GUARDS_METADATA, TenantCrmClientFeedbackController) as unknown[]).includes(ClientAccessTokenGuard));
  let passedClient = "";
  let featureEnabled = true;
  const controller = new TenantCrmClientFeedbackController({ submitClientFeedback: async (_tenantId: string, client: string) => { passedClient = client; return {}; } } as never,
    { requireFeature: async (_tenantId: string, feature: string) => {
      assert.equal(feature, SubscriptionFeatures.TenantCrm);
      if (!featureEnabled) throw new Error("feature unavailable");
    } } as never);
  const request = { [TENANT_CONTEXT]: { coffeeShopId: tenantId }, [CLIENT_PRINCIPAL]: { clientId, sessionId: randomUUID(), coffeeShopId: tenantId },
    [AUTH_PRINCIPAL]: { userId: actorId } } as never;
  const input = Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 5, orderId: randomUUID() });
  featureEnabled = false;
  await assert.rejects(() => controller.submit(request, input), /feature unavailable/);
  assert.equal(passedClient, "");
  featureEnabled = true;
  await controller.submit(request, input);
  assert.equal(passedClient, clientId);
});

test("PostgreSQL enforces Feedback tenant/Client/source ownership and projects summary and Timeline", {
  skip: !process.env.TENANT_CRM_INTEGRATION_DATABASE_URL,
}, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.TENANT_CRM_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error(`rollback ${randomUUID()}`);
  try {
    await assert.rejects(db.transaction(async (manager: EntityManager) => {
      const tenantA = randomUUID(), tenantB = randomUUID(), branchA = randomUUID(), branchB = randomUUID();
      const clientA = randomUUID(), clientOther = randomUUID(), clientB = randomUUID(), userA = randomUUID(), userB = randomUUID();
      const phone = (id: string) => `+98912${id.replaceAll("-", "").split("").map((character) => String(Number.parseInt(character, 16) % 10)).join("").slice(0, 7)}`;
      await manager.query(`INSERT INTO coffee_shops(id,name,slug,status,timezone) VALUES
        ($1,'Feedback fixture A',$2,'ACTIVE','Asia/Tehran'),($3,'Feedback fixture B',$4,'ACTIVE','Asia/Tehran')`,
      [tenantA, `fb-${tenantA.replaceAll("-", "").slice(0, 20)}`, tenantB, `fb-${tenantB.replaceAll("-", "").slice(0, 20)}`]);
      await manager.query(`INSERT INTO branches(id,coffee_shop_id,name,slug,is_primary,timezone) VALUES
        ($1,$2,'Main','main',true,'Asia/Tehran'),($3,$4,'Main','main',true,'Asia/Tehran')`, [branchA, tenantA, branchB, tenantB]);
      await manager.query(`INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone) VALUES
        ($1,$2,'آوا','رضایی',$3),($4,$2,'نورا','احمدی',$5),($6,$7,'آوا','رضایی',$8)`,
      [clientA, tenantA, phone(clientA), clientOther, phone(clientOther), clientB, tenantB, phone(clientB)]);
      await manager.query(`INSERT INTO users(id,email) VALUES($1,$2),($3,$4)`, [userA, `${userA}@feedback.test`, userB, `${userB}@feedback.test`]);
      await manager.query(`INSERT INTO coffee_shop_memberships(coffee_shop_id,user_id,status) VALUES($1,$2,'ACTIVE'),($3,$4,'ACTIVE')`, [tenantA, userA, tenantB, userB]);
      const addOrder = async (tenant: string, client: string, status: string) => {
        const rows = await manager.query(`INSERT INTO orders(coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,
          subtotal_before_discount_toman,discount_total_toman,order_discount_toman,idempotency_key)
          VALUES($1,$2,$3::order_status,'OFFLINE','PICKUP',100,100,0,0,$4) RETURNING id`, [tenant, client, status, randomUUID()]);
        return rows[0]!.id as string;
      };
      const orderA = await addOrder(tenantA, clientA, "DELIVERED");
      const orderOther = await addOrder(tenantA, clientOther, "DELIVERED");
      const orderB = await addOrder(tenantB, clientB, "DELIVERED");
      const addReservation = async (tenant: string, branch: string, client: string, status: string) => {
        const rows = await manager.query(`INSERT INTO reservations(coffee_shop_id,branch_id,client_id,contact_name,reservation_date,start_time,end_time,party_size,status)
          VALUES($1,$2,$3,'آوا رضایی','2026-10-05','18:00','19:30',2,$4::reservation_status) RETURNING id`, [tenant, branch, client, status]);
        return rows[0]!.id as string;
      };
      const reservationA = await addReservation(tenantA, branchA, clientA, "COMPLETED");
      const reservationOther = await addReservation(tenantA, branchA, clientOther, "COMPLETED");
      const reservationB = await addReservation(tenantB, branchB, clientB, "COMPLETED");
      let queryTail = Promise.resolve();
      const query = (sql: string, parameters?: unknown[]) => {
        const result = queryTail.then(() => manager.query(sql, parameters));
        queryTail = result.then(() => undefined, () => undefined);
        return result;
      };
      const transactionManager = { query } as unknown as EntityManager;
      const source = { query, transaction: (work: (transaction: EntityManager) => Promise<unknown>) => work(transactionManager) } as unknown as DataSource;
      const service = new TenantCrmService(source);
      const foreignFeedback = await service.createFeedback(tenantB, userB,
        Object.assign(new CreateTenantCrmFeedbackDto(), { clientId: clientB, rating: 5, comment: "Separate café" })) as unknown as Record<string, unknown>;
      const orderFeedback = await service.submitClientFeedback(tenantA, clientA,
        Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 2, comment: "Late", orderId: orderA })) as unknown as Record<string, unknown>;
      await service.submitClientFeedback(tenantA, clientA, Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 4, reservationId: reservationA }));
      await assert.rejects(() => service.submitClientFeedback(tenantA, clientA, Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 5, orderId: orderA })), ConflictException);
      await assert.rejects(() => service.submitClientFeedback(tenantA, clientA, Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 5, orderId: orderOther })), NotFoundException);
      await assert.rejects(() => service.submitClientFeedback(tenantA, clientA, Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 5, orderId: orderB })), NotFoundException);
      await assert.rejects(() => service.submitClientFeedback(tenantA, clientA, Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 5, reservationId: reservationOther })), NotFoundException);
      await assert.rejects(() => service.submitClientFeedback(tenantA, clientA, Object.assign(new SubmitTenantCrmFeedbackDto(), { rating: 5, reservationId: reservationB })), NotFoundException);
      await assert.rejects(() => service.feedbackDetail(tenantA, String(foreignFeedback.id)), NotFoundException);
      await assert.rejects(() => service.detail(tenantA, clientB), NotFoundException);

      const safeCustomerProjection = await service.clientFeedbackForOrder(tenantA, clientA, orderA) as Record<string, unknown>;
      assert.equal(safeCustomerProjection.rating, 2);
      assert.equal("status" in safeCustomerProjection, false);
      assert.equal("resolutionNote" in safeCustomerProjection, false);
      const customer360 = await service.detail(tenantA, clientA);
      assert.equal(customer360.summary.feedback.count, 2);
      assert.equal(customer360.summary.feedback.averageRating, "3.0");
      assert.equal(customer360.summary.feedback.negativeCount, 1);
      assert.equal(customer360.summary.feedback.needsAttentionCount, 1);
      assert.ok(customer360.summary.feedback.lastFeedbackAt instanceof Date);
      assert.equal(customer360.recentFeedback.length, 2);
      assert.equal(customer360.summary.feedback.lastFeedbackAt!.toISOString(),
        ((customer360.recentFeedback[0] as Record<string, unknown>).createdAt as Date).toISOString());
      const inbox = await service.listFeedback(tenantA, Object.assign(new TenantCrmFeedbackListQueryDto(), {
        clientId: clientA, status: "NEEDS_ATTENTION" as const, dateFrom: "2020-01-01", dateTo: "2030-12-31", page: 1, pageSize: 10,
      }), "Asia/Tehran");
      assert.equal(inbox.total, 1);
      assert.equal((inbox.items[0] as unknown as Record<string, unknown>).status, "NEEDS_ATTENTION");
      const tenantInbox = await service.listFeedback(tenantA, Object.assign(new TenantCrmFeedbackListQueryDto(), {
        dateFrom: "2020-01-01", dateTo: "2030-12-31", page: 1, pageSize: 10,
      }), "Asia/Tehran");
      assert.equal(tenantInbox.total, 2);
      await service.resolveFeedback(tenantA, userA, String(orderFeedback.id), { resolutionNote: "Called and apologized" });
      assert.equal((await service.detail(tenantA, clientA)).summary.feedback.needsAttentionCount, 0);
      const reminder = await service.createReminder(tenantA, clientA, userA, Object.assign(new CreateTenantCrmReminderDto(), {
        title: "Call about feedback", description: `Feedback ${orderFeedback.id}`, dueAt: "2030-10-06T09:00:00.000Z",
      })) as { id: string };
      const reminderRows = await manager.query(`SELECT coffee_shop_id,client_id FROM tenant_crm_reminders WHERE id=$1`, [reminder.id]);
      assert.deepEqual(reminderRows[0], { coffee_shop_id: tenantA, client_id: clientA });

      const timelineEvents: Array<{ eventKey: string; type: string }> = [];
      let cursor: string | undefined;
      do {
        const page = await service.timeline(tenantA, clientA, Object.assign(new ClientTimelineQueryDto(), { pageSize: 1, cursor }));
        timelineEvents.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      const feedbackEvents = timelineEvents.filter(({ type }) => type === "FEEDBACK_RECEIVED" || type === "FEEDBACK_RESOLVED");
      assert.deepEqual(feedbackEvents.map(({ type }) => type).sort(), ["FEEDBACK_RECEIVED", "FEEDBACK_RECEIVED", "FEEDBACK_RESOLVED"]);
      assert.equal(new Set(timelineEvents.map(({ eventKey }) => eventKey)).size, timelineEvents.length);
      assert.equal(timelineEvents.some(({ eventKey }) => eventKey.includes(orderOther) || eventKey.includes(orderB)
        || eventKey.includes(reservationOther) || eventKey.includes(reservationB)), false);

      const rejectFk = async (sql: string, values: unknown[]) => {
        await manager.query("SAVEPOINT crm_feedback_fk");
        await assert.rejects(manager.query(sql, values));
        await manager.query("ROLLBACK TO SAVEPOINT crm_feedback_fk");
        await manager.query("RELEASE SAVEPOINT crm_feedback_fk");
      };
      const insertLinked = `INSERT INTO tenant_crm_feedback(coffee_shop_id,client_id,rating,source,order_id,status,created_by_user_id)
        VALUES($1,$2,4,'MANUAL',$3,'NEW',$4)`;
      await rejectFk(insertLinked, [tenantA, clientA, orderOther, userA]);
      await rejectFk(insertLinked, [tenantA, clientA, orderB, userA]);
      await rejectFk(`INSERT INTO tenant_crm_feedback(coffee_shop_id,client_id,rating,source,reservation_id,status,created_by_user_id)
        VALUES($1,$2,4,'MANUAL',$3,'NEW',$4)`, [tenantA, clientA, reservationOther, userA]);
      await rejectFk(`INSERT INTO tenant_crm_feedback(coffee_shop_id,client_id,rating,source,status,created_by_user_id)
        VALUES($1,$2,4,'MANUAL','NEW',$3)`, [tenantA, clientA, userB]);
      await rejectFk(`INSERT INTO tenant_crm_feedback(coffee_shop_id,client_id,rating,source,order_id,status,created_by_user_id)
        VALUES($1,$2,4,'CUSTOMER_PANEL',$3,'NEW',$4)`, [tenantA, clientA, orderA, userA]);
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.destroy(); }
});
