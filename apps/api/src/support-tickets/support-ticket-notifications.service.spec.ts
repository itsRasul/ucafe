import assert from "node:assert/strict";
import test from "node:test";
import { EntityManager } from "typeorm";
import { NotificationType } from "../notifications/notification-type";
import { SupportTicketDepartment } from "./entities";
import { SupportTicketNotificationsService } from "./support-ticket-notifications.service";

test("ticket notifications fan out safe activity data to verified reply-capable Platform users", async () => {
  const managerCalls: string[] = [];
  const manager = {
    query: async (sql: string) => {
      managerCalls.push(sql);
      return sql.includes("support.tickets.reply") ? [
        { userId: "support-a", phone: "+989120000001" },
        { userId: "support-b", phone: "+989120000002" },
      ] : [{ phone: "+989120000003" }];
    },
  } as unknown as EntityManager;
  const enqueued: Array<Record<string, unknown>> = [];
  const notifications = { enqueue: async (_manager: EntityManager, value: Record<string, unknown>) => { enqueued.push(value); } };
  const service = new SupportTicketNotificationsService(notifications as never);
  const ticket = { id: "ticket-id", coffeeShopId: "tenant-id", createdByUserId: "tenant-user", referenceNumber: "UC-123", department: SupportTicketDepartment.Technical };

  await service.created(manager, ticket);
  await service.tenantReplied(manager, ticket, "message-a");
  await service.platformReplied(manager, ticket, "message-b");

  assert.equal(managerCalls.filter((sql) => sql.includes("support.tickets.reply") && sql.includes("phone_verified_at")).length, 2);
  assert.equal(managerCalls.some((sql) => sql.includes("id=$1") && sql.includes("phone_verified_at")), true);
  assert.equal(managerCalls.some((sql) => sql.includes("support.tickets.use") && sql.includes("membership_roles")), true);
  assert.equal(enqueued.length, 5);
  assert.deepEqual(enqueued.slice(0, 2).map((item) => item.type), [NotificationType.TicketCreated, NotificationType.TicketCreated]);
  assert.deepEqual(enqueued.slice(2, 4).map((item) => item.type), [NotificationType.TicketTenantReplied, NotificationType.TicketTenantReplied]);
  assert.equal(enqueued[4]?.type, NotificationType.TicketPlatformReplied);
  assert.equal(enqueued[0]?.payload && (enqueued[0].payload as Record<string, string>).department, "فنی");
  assert.equal(enqueued[0]?.deduplicationKey, `${NotificationType.TicketCreated}:ticket-id:support-a`);
  assert.deepEqual(enqueued.map((item) => item.phone), ["+989120000001", "+989120000002", "+989120000001", "+989120000002", "+989120000003"]);
  assert.ok(enqueued.every((item) => JSON.stringify(item.payload).includes("UC-123") && !JSON.stringify(item.payload).includes("message body")));
  assert.ok(enqueued.every((item) => item.relatedEntityId === "ticket-id"));
});

test("a missing verified Ticket creator phone safely skips the Tenant SMS", async () => {
  const manager = { query: async () => [] } as unknown as EntityManager;
  let enqueueCount = 0;
  const service = new SupportTicketNotificationsService({ enqueue: async () => { enqueueCount += 1; } } as never);

  await service.platformReplied(manager, {
    id: "ticket-id", coffeeShopId: "tenant-id", createdByUserId: "tenant-user",
    referenceNumber: "UC-123", department: SupportTicketDepartment.Sales,
  }, "message-id");

  assert.equal(enqueueCount, 0);
});
