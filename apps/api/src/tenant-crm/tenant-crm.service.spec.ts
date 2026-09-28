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
import { TenantCrmResourcesController } from "./tenant-crm-resources.controller";
import { TenantCrmService } from "./tenant-crm.service";
import { ClientDirectoryQueryDto } from "./dto/client-directory-query.dto";
import { ClientTimelineQueryDto } from "./dto/client-timeline-query.dto";
import { decodeTimelineCursor, encodeTimelineCursor } from "./timeline-cursor.util";
import { CreateTenantCrmCustomFieldDto, CreateTenantCrmNoteDto, CreateTenantCrmReminderDto, CreateTenantCrmTagDto, TenantCrmNoteListQueryDto,
  TenantCrmReminderListQueryDto, TenantCrmTagListQueryDto, UpdateTenantCrmCustomFieldDto, UpdateTenantCrmCustomFieldValuesDto,
  UpdateTenantCrmNoteDto, UpdateTenantCrmPreferencesDto, UpdateTenantCrmReminderDto } from "./dto/tenant-crm-phase3.dto";

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
  const crmCursor = { occurredAt: "2026-09-04T00:00:00.000Z", eventKey: "REMINDER:123e4567-e89b-12d3-a456-426614174000:COMPLETED" };
  assert.deepEqual(decodeTimelineCursor(encodeTimelineCursor(crmCursor)), crmCursor);
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

test("Tenant CRM notes use bounded tenant/client-scoped reads and preserve the User actor", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const note = { id: "note-a", clientId: "client-a", body: "Weekend regular", createdByUserId: "user-a", authorLabel: "کاربر ·•••1234", archivedAt: null };
  const manager = { query: async (sql: string, parameters: unknown[] = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("SELECT id FROM clients")) return [{ id: "client-a" }];
    if (sql.startsWith("SELECT COUNT(*)")) return [{ total: "1" }];
    if (sql.startsWith("INSERT INTO tenant_crm_client_notes")) return [{ id: "note-a" }];
    if (sql.startsWith("UPDATE tenant_crm_client_notes")) return [{ id: "note-a" }];
    if (sql.includes("FROM tenant_crm_client_notes n")) return [note];
    return [];
  } };
  const source = { query: manager.query, transaction: async (run: (tx: typeof manager) => unknown) => run(manager) } as unknown as DataSource;
  const service = new TenantCrmService(source);
  const query = Object.assign(new TenantCrmNoteListQueryDto(), { page: 2, pageSize: 10 });
  const listed = await service.listNotes("tenant-a", "client-a", query);
  assert.equal(listed.total, 1);
  assert.deepEqual(calls[0]!.parameters, ["tenant-a", "client-a"]);
  assert.match(calls[0]!.sql, /coffee_shop_id=\$1 AND id=\$2/);
  assert.deepEqual(calls[2]!.parameters, ["tenant-a", "client-a", 10, 10]);
  assert.match(calls[2]!.sql, /ORDER BY n\.created_at DESC,n\.id DESC LIMIT \$3 OFFSET \$4/);

  const created = await service.createNote("tenant-a", "client-a", "user-a", Object.assign(new CreateTenantCrmNoteDto(), { body: "  Weekend regular  " }));
  assert.equal(created, note);
  const insert = calls.find((call) => call.sql.startsWith("INSERT INTO tenant_crm_client_notes"))!;
  assert.match(insert.sql, /created_by_user_id,updated_by_user_id/);
  assert.deepEqual(insert.parameters, ["tenant-a", "client-a", "Weekend regular", "user-a"]);

  const updated = await service.updateNote("tenant-a", "client-a", "note-a", "user-b", Object.assign(new UpdateTenantCrmNoteDto(), { body: "Updated" }));
  assert.equal(updated, note);
  const update = calls.find((call) => call.sql.startsWith("UPDATE tenant_crm_client_notes"))!;
  assert.match(update.sql, /id=\$1 AND coffee_shop_id=\$2 AND client_id=\$3 AND archived_at IS NULL/);
  assert.deepEqual(update.parameters, ["note-a", "tenant-a", "client-a", "Updated", "user-b"]);
});

test("foreign Client and Note ids cannot be used for tenant CRM note writes", async () => {
  const manager = { query: async (sql: string) => sql.includes("SELECT id FROM clients") ? [] : [] };
  const source = { query: manager.query, transaction: async (run: (tx: typeof manager) => unknown) => run(manager) } as unknown as DataSource;
  const service = new TenantCrmService(source);
  await assert.rejects(() => service.createNote("tenant-a", "client-b", "user-a", Object.assign(new CreateTenantCrmNoteDto(), { body: "private" })), NotFoundException);
  await assert.rejects(() => service.updateNote("tenant-a", "client-a", "note-b", "user-a", Object.assign(new UpdateTenantCrmNoteDto(), { body: "private" })), NotFoundException);
  await assert.rejects(() => service.archiveNote("tenant-a", "client-a", "note-b", "user-a"), NotFoundException);
});

test("note mutations require both tenant CRM read and manage permissions", async () => {
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmController.prototype.createNote), [TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage]);
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmController.prototype.updateNote), [TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage]);
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmController.prototype.archiveNote), [TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage]);
});

test("explicit hospitality preferences are tenant/client scoped and store only month and day for birthdays", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const manager = { query: async (sql: string, parameters: unknown[] = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("SELECT id FROM clients")) return [{ id: "client-a" }];
    if (sql.startsWith("SELECT client_id AS")) return [{ clientId: "client-a", preferredSeating: "Outdoor", birthdayMonthDay: "02-29" }];
    return [];
  } };
  const source = { query: manager.query, transaction: async (run: (tx: typeof manager) => unknown) => run(manager) } as unknown as DataSource;
  const service = new TenantCrmService(source);
  const input = Object.assign(new UpdateTenantCrmPreferencesDto(), { preferredSeating: " Outdoor ", birthdayMonthDay: "02-29" });
  const result = await service.updatePreferences("tenant-a", "client-a", "user-a", input);
  assert.equal(result.birthdayMonthDay, "02-29");
  const upsert = calls.find((call) => call.sql.startsWith("INSERT INTO tenant_crm_client_profiles"))!;
  assert.match(upsert.sql, /ON CONFLICT\(coffee_shop_id,client_id\)/);
  assert.deepEqual(upsert.parameters, ["tenant-a", "client-a", "Outdoor", "02-29", "user-a"]);
  await assert.rejects(() => service.updatePreferences("tenant-a", "client-a", "user-a", Object.assign(new UpdateTenantCrmPreferencesDto(), { birthdayMonthDay: "02-30" })), BadRequestException);
});

test("tenant tags are idempotently assigned and client reads stay scoped", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const manager = { query: async (sql: string, parameters: unknown[] = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("SELECT id FROM clients")) return [{ id: "client-a" }];
    if (sql.startsWith("SELECT id FROM tenant_crm_tags")) return [{ id: "tag-a" }];
    if (sql.startsWith("INSERT INTO tenant_crm_client_tags")) return [];
    if (sql.includes("FROM tenant_crm_client_tags ct JOIN tenant_crm_tags")) return [{ id: "tag-a", name: "VIP" }];
    if (sql.startsWith("INSERT INTO tenant_crm_tags")) return [{ id: "tag-a" }];
    if (sql.startsWith("SELECT t.id,t.name,t.archived_at")) return [{ id: "tag-a", name: "VIP", clientCount: 1 }];
    return [];
  } };
  const source = { query: manager.query, transaction: async (run: (tx: typeof manager) => unknown) => run(manager) } as unknown as DataSource;
  const service = new TenantCrmService(source);
  const created = await service.createTag("tenant-a", "user-a", Object.assign(new CreateTenantCrmTagDto(), { name: " VIP " }));
  assert.equal(created.name, "VIP");
  await service.assignTag("tenant-a", "client-a", "tag-a", "user-a");
  await service.assignTag("tenant-a", "client-a", "tag-a", "user-a");
  const assignments = calls.filter((call) => call.sql.startsWith("INSERT INTO tenant_crm_client_tags"));
  assert.equal(assignments.length, 2);
  assert.ok(assignments.every((call) => /ON CONFLICT\(coffee_shop_id,client_id,tag_id\) DO NOTHING/.test(call.sql)));
  const tagReads = calls.filter((call) => call.sql.includes("FROM tenant_crm_client_tags ct JOIN tenant_crm_tags"));
  assert.ok(tagReads.every((call) => call.parameters[0] === "tenant-a" && call.parameters[1] === "client-a"));
});

test("custom field values validate their declared types and reject foreign select options", async () => {
  const optionA = "123e4567-e89b-42d3-a456-426614174000", optionB = "123e4567-e89b-42d3-a456-426614174001";
  const specs = ["TEXT", "LONG_TEXT", "NUMBER", "BOOLEAN", "DATE", "SINGLE_SELECT", "MULTI_SELECT", "URL"] as const;
  const fields = specs.map((dataType, index) => ({ id: `field-${index}`, key: dataType.toLowerCase(), dataType, required: false }));
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const manager = { query: async (sql: string, parameters: unknown[] = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("SELECT id FROM clients")) return [{ id: "client-a" }];
    if (sql.startsWith("SELECT id,key,data_type")) return fields;
    if (sql.startsWith("SELECT id FROM tenant_crm_custom_field_options")) {
      const requested = parameters[2];
      return (Array.isArray(requested) ? requested : [requested]).map((id) => ({ id }));
    }
    if (sql.startsWith("SELECT d.key FROM tenant_crm_custom_field_definitions d")) return [];
    if (sql.startsWith("SELECT d.id,d.key")) return fields.map((field) => ({ ...field, options: [] }));
    if (sql.startsWith("SELECT d.key,v.value")) return calls.filter((call) => call.sql.startsWith("INSERT INTO tenant_crm_client_custom_field_values"))
      .map((call) => ({ key: String(call.parameters[2]), value: JSON.parse(String(call.parameters[3])) }));
    return [];
  } };
  const source = { query: manager.query, transaction: async (run: (tx: typeof manager) => unknown) => run(manager) } as unknown as DataSource;
  const service = new TenantCrmService(source);
  const input = Object.assign(new UpdateTenantCrmCustomFieldValuesDto(), { values: {
    text: "Acme", long_text: "A customer request", number: 4.5, boolean: true, date: "2026-09-28",
    single_select: optionA, multi_select: [optionA, optionB], url: "https://example.com/path",
  } });
  const result = await service.updateClientCustomFields("tenant-a", "client-a", "user-a", input);
  assert.equal(result.fields.length, 8);
  assert.equal(calls.filter((call) => call.sql.startsWith("INSERT INTO tenant_crm_client_custom_field_values")).length, 8);
  assert.deepEqual(calls.filter((call) => call.sql.startsWith("INSERT INTO tenant_crm_client_custom_field_values"))[5]!.parameters.slice(0, 3), ["tenant-a", "client-a", "field-5"]);

  const noForeignOption = { ...manager, query: async (sql: string, parameters: unknown[] = []) => {
    if (sql.startsWith("SELECT id FROM clients")) return [{ id: "client-a" }];
    if (sql.startsWith("SELECT id,key,data_type")) return [fields[5]];
    if (sql.startsWith("SELECT id FROM tenant_crm_custom_field_options")) return [];
    return [];
  } };
  const isolated = new TenantCrmService({ query: noForeignOption.query, transaction: async (run: (tx: typeof noForeignOption) => unknown) => run(noForeignOption) } as unknown as DataSource);
  await assert.rejects(() => isolated.updateClientCustomFields("tenant-a", "client-a", "user-a", Object.assign(new UpdateTenantCrmCustomFieldValuesDto(), { values: { single_select: optionA } })), BadRequestException);
  const invalidOptions = new TenantCrmService({} as DataSource);
  await assert.rejects(() => invalidOptions.createCustomField("tenant-a", "user-a", Object.assign(new CreateTenantCrmCustomFieldDto(), { key: "duplicate", label: "Duplicate", dataType: "SINGLE_SELECT", options: [{ id: optionA, label: "One" }, { id: optionA, label: "Two" }] })), BadRequestException);
  assert.equal("dataType" in UpdateTenantCrmCustomFieldDto.prototype, false);
});

test("required multi-select fields reject an empty selection", async () => {
  const manager = { query: async (sql: string) => {
    if (sql.includes("SELECT id FROM clients")) return [{ id: "client-a" }];
    if (sql.startsWith("SELECT id,key,data_type")) return [{ id: "field-a", key: "interests", dataType: "MULTI_SELECT", required: true }];
    return [];
  } };
  const source = { query: manager.query, transaction: async (run: (tx: typeof manager) => unknown) => run(manager) } as unknown as DataSource;
  const service = new TenantCrmService(source);
  await assert.rejects(() => service.updateClientCustomFields("tenant-a", "client-a", "user-a",
    Object.assign(new UpdateTenantCrmCustomFieldValuesDto(), { values: { interests: [] } })), BadRequestException);
});

test("reminder queries derive overdue status and use the café timezone for the today view", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const source = { query: async (sql: string, parameters: unknown[] = []) => {
    calls.push({ sql, parameters });
    return sql.startsWith("SELECT COUNT(*)") ? [{ total: "1" }] : [{ id: "reminder-a", status: "OPEN", overdue: true }];
  } } as unknown as DataSource;
  const service = new TenantCrmService(source);
  const overdue = await service.listReminders("tenant-a", "Asia/Tehran", Object.assign(new TenantCrmReminderListQueryDto(), { view: "OVERDUE" as const, page: 2, pageSize: 10 }));
  assert.equal(overdue.items[0]!.overdue, true);
  assert.match(calls[0]!.sql, /r\.coffee_shop_id=\$1 AND r\.status='OPEN' AND r\.due_at < now\(\)/);
  assert.match(calls[1]!.sql, /r\.status='OPEN' AND r\.due_at < now\(\)/);
  assert.match(calls[1]!.sql, /r\.due_at < now\(\)\) AS "overdue"/);
  calls.length = 0;
  await service.listReminders("tenant-a", "Asia/Tehran", Object.assign(new TenantCrmReminderListQueryDto(), { view: "TODAY" as const }));
  assert.match(calls[0]!.sql, /AT TIME ZONE \$2/);
  assert.deepEqual(calls[0]!.parameters, ["tenant-a", "Asia/Tehran"]);
});

test("reminder creation and completion preserve tenant ownership and lifecycle timestamps", async () => {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  let currentStatus = "OPEN";
  const manager = { query: async (sql: string, parameters: unknown[] = []) => {
    calls.push({ sql, parameters });
    if (sql.includes("SELECT id FROM clients")) return [{ id: "client-a" }];
    if (sql.includes("FROM coffee_shop_memberships m JOIN users")) return [{ id: "user-b" }];
    if (sql.startsWith("INSERT INTO tenant_crm_reminders")) return [{ id: "reminder-a" }];
    if (sql.startsWith("SELECT id,client_id AS \"clientId\",title,description,due_at")) return [{ id: "reminder-a", clientId: "client-a", title: "Call", description: null, dueAt: new Date("2026-09-29T06:30:00Z"), status: currentStatus, assignedToUserId: "user-b", completedAt: null }];
    if (sql.startsWith("UPDATE tenant_crm_reminders SET")) { currentStatus = String(parameters[5]); return []; }
    if (sql.startsWith("SELECT r.id,r.client_id")) return [{ id: "reminder-a", status: currentStatus, overdue: false }];
    return [];
  } };
  const source = { query: manager.query, transaction: async (run: (tx: typeof manager) => unknown) => run(manager) } as unknown as DataSource;
  const service = new TenantCrmService(source);
  const created = await service.createReminder("tenant-a", "client-a", "user-a", Object.assign(new CreateTenantCrmReminderDto(), { title: "Call", dueAt: "2026-09-29T06:30:00.000Z", assignedToUserId: "user-b" }));
  assert.equal(created.id, "reminder-a");
  assert.deepEqual(calls.find((call) => call.sql.startsWith("INSERT INTO tenant_crm_reminders"))!.parameters.slice(0, 2), ["tenant-a", "client-a"]);
  const completed = await service.updateReminder("tenant-a", "reminder-a", "user-a", Object.assign(new UpdateTenantCrmReminderDto(), { status: "COMPLETED" as const }));
  assert.equal(completed.status, "COMPLETED");
  const update = calls.find((call) => call.sql.startsWith("UPDATE tenant_crm_reminders SET"))!;
  assert.equal(update.parameters[5], "COMPLETED");
  assert.ok(update.parameters[7] instanceof Date);
  assert.match(update.sql, /WHERE coffee_shop_id=\$1 AND id=\$2/);
});

test("Phase 3 controllers keep reads behind entitlement and writes behind tenant_crm.manage", async () => {
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmResourcesController), [TenantPermissions.TenantCrmRead]);
  for (const method of ["createTag", "updateTag", "archiveTag", "createCustomField", "updateCustomField", "updateReminder"] as const) {
    assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmResourcesController.prototype[method]), [TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage]);
  }
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmResourcesController.prototype.users), [TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage]);
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmController.prototype.updatePreferences), [TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage]);
  let reachedService = false;
  const request = { [TENANT_CONTEXT]: { coffeeShopId: "tenant-a", timezone: "Asia/Tehran" }, [AUTH_PRINCIPAL]: { userId: "user-a", sessionId: "session-a" } } as unknown as AuthorizedRequest;
  const resources = new TenantCrmResourcesController({ listTags: async () => { reachedService = true; } } as never,
    { requireFeature: async (_tenantId: string, feature: string) => { assert.equal(feature, SubscriptionFeatures.TenantCrm); throw new Error("feature unavailable"); } } as never);
  await assert.rejects(() => resources.tags(request, new TenantCrmTagListQueryDto()), /feature unavailable/);
  assert.equal(reachedService, false);
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

test("Phase 3 persists isolated CRM relationships and composite keys reject foreign tenant references", { skip: !process.env.TENANT_CRM_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.TENANT_CRM_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error(`rollback ${randomUUID()}`);
  try {
    await assert.rejects(db.transaction(async (manager: EntityManager) => {
      const tenantA = randomUUID(), tenantB = randomUUID(), clientA = randomUUID(), clientB = randomUUID(), userA = randomUUID(), userB = randomUUID();
      await manager.query(`INSERT INTO coffee_shops(id,name,slug,status,timezone) VALUES($1,'CRM phase 3 A',$2,'ACTIVE','Asia/Tehran'),($3,'CRM phase 3 B',$4,'ACTIVE','Asia/Tehran')`,
        [tenantA, `crm-${tenantA.replaceAll("-", "").slice(0, 20)}`, tenantB, `crm-${tenantB.replaceAll("-", "").slice(0, 20)}`]);
      await manager.query(`INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone) VALUES($1,$2,'آوا','رضایی',$3),($4,$5,'آوا','رضایی',$6)`,
        [clientA, tenantA, "+989120000071", clientB, tenantB, "+989120000072"]);
      await manager.query(`INSERT INTO users(id,email) VALUES($1,$2),($3,$4)`, [userA, `${userA}@crm.test`, userB, `${userB}@crm.test`]);
      await manager.query(`INSERT INTO coffee_shop_memberships(coffee_shop_id,user_id,status) VALUES($1,$2,'ACTIVE'),($3,$4,'ACTIVE')`, [tenantA, userA, tenantB, userB]);
      const source = { query: manager.query.bind(manager), transaction: async (run: (tx: EntityManager) => unknown) => run(manager) } as unknown as DataSource;
      const service = new TenantCrmService(source);
      assert.deepEqual((await service.listActiveTenantUsers(tenantA)).map((user) => user.id), [userA]);

      const tagA = await service.createTag(tenantA, userA, Object.assign(new CreateTenantCrmTagDto(), { name: "VIP" })) as { id: string };
      const tagB = await service.createTag(tenantB, userB, Object.assign(new CreateTenantCrmTagDto(), { name: "VIP" })) as { id: string };
      assert.notEqual(tagA.id, tagB.id);
      await service.assignTag(tenantA, clientA, tagA.id, userA);
      await service.assignTag(tenantA, clientA, tagA.id, userA);
      const [assignment] = await manager.query(`SELECT COUNT(*)::int AS count FROM tenant_crm_client_tags WHERE coffee_shop_id=$1 AND client_id=$2 AND tag_id=$3`, [tenantA, clientA, tagA.id]);
      assert.equal(assignment.count, 1);
      assert.deepEqual((await service.clientTags(tenantA, clientA)).map((tag) => tag.name), ["VIP"]);
      assert.deepEqual(await service.clientTags(tenantB, clientB), []);

      await service.createNote(tenantA, clientA, userA, Object.assign(new CreateTenantCrmNoteDto(), { body: "Weekend regular" }));
      const notes = await service.listNotes(tenantA, clientA, Object.assign(new TenantCrmNoteListQueryDto(), { page: 1, pageSize: 10 }));
      assert.equal(notes.total, 1);
      assert.equal(notes.items[0]!.body, "Weekend regular");
      await service.updatePreferences(tenantA, clientA, userA, Object.assign(new UpdateTenantCrmPreferencesDto(), { favoriteDrink: "Flat White", birthdayMonthDay: "02-29" }));
      assert.equal((await service.preferences(tenantA, clientA)).birthdayMonthDay, "02-29");
      const field = await service.createCustomField(tenantA, userA, Object.assign(new CreateTenantCrmCustomFieldDto(), { key: "office", label: "Office", dataType: "TEXT" })) as { id: string };
      await service.updateClientCustomFields(tenantA, clientA, userA, Object.assign(new UpdateTenantCrmCustomFieldValuesDto(), { values: { office: "Acme" } }));
      assert.equal((await service.clientCustomFields(tenantA, clientA)).fields[0]!.value, "Acme");
      const reminder = await service.createReminder(tenantA, clientA, userA, Object.assign(new CreateTenantCrmReminderDto(), { title: "Follow up", dueAt: "2030-02-03T10:00:00.000Z" })) as { id: string };
      await service.updateReminder(tenantA, reminder.id, userA, Object.assign(new UpdateTenantCrmReminderDto(), { status: "COMPLETED" as const }));
      const reminders = await service.listReminders(tenantA, "Asia/Tehran", Object.assign(new TenantCrmReminderListQueryDto(), { view: "ALL" as const, clientId: clientA, page: 1, pageSize: 10 }));
      assert.equal(reminders.total, 1);
      const timeline = await service.timeline(tenantA, clientA, Object.assign(new ClientTimelineQueryDto(), { pageSize: 50 }));
      assert.deepEqual(timeline.items.filter((item) => item.sourceType === "NOTE" || item.sourceType === "REMINDER").map((item) => item.type).sort(), ["NOTE_CREATED", "REMINDER_COMPLETED", "REMINDER_CREATED"]);
      assert.equal(JSON.stringify(timeline.items).includes("Weekend regular"), false);

      const rejectsCrossTenant = async (sql: string, values: unknown[]) => {
        await manager.query("SAVEPOINT crm_phase3_fk");
        await assert.rejects(manager.query(sql, values));
        await manager.query("ROLLBACK TO SAVEPOINT crm_phase3_fk");
        await manager.query("RELEASE SAVEPOINT crm_phase3_fk");
      };
      await rejectsCrossTenant(`INSERT INTO tenant_crm_client_notes(coffee_shop_id,client_id,body,created_by_user_id,updated_by_user_id) VALUES($1,$2,'foreign client',$3,$3)`, [tenantA, clientB, userA]);
      await rejectsCrossTenant(`INSERT INTO tenant_crm_client_notes(coffee_shop_id,client_id,body,created_by_user_id,updated_by_user_id) VALUES($1,$2,'foreign actor',$3,$3)`, [tenantA, clientA, userB]);
      await rejectsCrossTenant(`INSERT INTO tenant_crm_client_tags(coffee_shop_id,client_id,tag_id,created_by_user_id) VALUES($1,$2,$3,$4)`, [tenantB, clientB, tagA.id, userB]);
      await rejectsCrossTenant(`INSERT INTO tenant_crm_client_custom_field_values(coffee_shop_id,client_id,field_definition_id,value,updated_by_user_id) VALUES($1,$2,$3,'"foreign"'::jsonb,$4)`, [tenantB, clientB, field.id, userB]);
      await rejectsCrossTenant(`INSERT INTO tenant_crm_reminders(coffee_shop_id,client_id,title,due_at,assigned_to_user_id,created_by_user_id) VALUES($1,$2,'foreign assignee',now(),$3,$4)`, [tenantA, clientA, userB, userA]);
      await assert.rejects(() => service.assignTag(tenantA, clientB, tagA.id, userA), NotFoundException);
      await assert.rejects(() => service.createReminder(tenantA, clientA, userA, Object.assign(new CreateTenantCrmReminderDto(), { title: "Wrong assignee", dueAt: "2030-02-03T10:00:00.000Z", assignedToUserId: userB })), BadRequestException);
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
