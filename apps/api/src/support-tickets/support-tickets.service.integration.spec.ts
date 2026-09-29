import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { DataSource, EntityManager } from "typeorm";
import { PlatformAuditService } from "../audit/platform-audit.service";
import { Branch, CoffeeShop, Domain } from "../database/entities";
import { CoffeeShopMembership, MembershipRole, Permission, Role, User, UserPlatformRole } from "../identity/entities";
import { AuthorizationService } from "../authorization/authorization.service";
import { PlatformPermissions, TenantPermissions } from "../authorization/permission.constants";
import { SupportTicket, SupportTicketMessage, SupportTicketDepartment, SupportTicketStatus } from "./entities";
import { SupportTicketsService } from "./support-tickets.service";

const integrationUrl = process.env.TICKETING_INTEGRATION_DATABASE_URL;
const entities = [CoffeeShop, Branch, Domain, User, CoffeeShopMembership, MembershipRole, Role, Permission, UserPlatformRole, SupportTicket, SupportTicketMessage];

test("support ticket persistence, tenant isolation, permissions, transactions, replies, closure, and reference concurrency", { skip: !integrationUrl && "Set TICKETING_INTEGRATION_DATABASE_URL to run against PostgreSQL" }, async () => {
  const db = new DataSource({ type: "postgres", url: integrationUrl!, entities, synchronize: false, migrationsRun: false });
  const ids = { tenantA: randomUUID(), tenantB: randomUUID(), tenantUserA: randomUUID(), tenantUserB: randomUUID(), platformReply: randomUUID(), platformOwner: randomUUID(), viewOnly: randomUUID(), viewRole: randomUUID(), replyOnly: randomUUID(), replyRole: randomUUID() };
  const ticketIds: string[] = [];
  const slug = randomUUID().replaceAll("-", "");
  try {
    await db.initialize();
    await db.query(`INSERT INTO coffee_shops (id,name,slug,status) VALUES ($1,'Ticket fixture A',$3,'ACTIVE'),($2,'Ticket fixture B',$4,'ACTIVE')`, [ids.tenantA, ids.tenantB, `ticket-a-${slug}`, `ticket-b-${slug}`]);
    await db.query(`INSERT INTO users (id,email,status) VALUES ($1,$3,'ACTIVE'),($2,$4,'ACTIVE'),($5,$6,'ACTIVE'),($7,$8,'ACTIVE'),($9,$10,'ACTIVE'),($11,$12,'ACTIVE')`,
      [ids.tenantUserA, ids.tenantUserB, `tenant-a-${slug}@example.invalid`, `tenant-b-${slug}@example.invalid`, ids.platformReply, `support-${slug}@example.invalid`, ids.platformOwner, `owner-${slug}@example.invalid`, ids.viewOnly, `viewer-${slug}@example.invalid`, ids.replyOnly, `reply-only-${slug}@example.invalid`]);
    await db.query(`INSERT INTO coffee_shop_memberships (coffee_shop_id,user_id,status) VALUES ($1,$3,'ACTIVE'),($2,$4,'ACTIVE')`, [ids.tenantA, ids.tenantB, ids.tenantUserA, ids.tenantUserB]);
    await db.query(`INSERT INTO membership_roles (membership_id,role_id) SELECT m.id,r.id FROM coffee_shop_memberships m JOIN roles r ON r.key='owner' AND r.scope='TENANT' AND r.coffee_shop_id IS NULL WHERE (m.coffee_shop_id,m.user_id) IN (($1,$3),($2,$4))`, [ids.tenantA, ids.tenantB, ids.tenantUserA, ids.tenantUserB]);
    await db.query(`INSERT INTO user_platform_roles (user_id,role_id) SELECT $1,id FROM roles WHERE scope='PLATFORM' AND key='support_operator'`, [ids.platformReply]);
    await db.query(`INSERT INTO user_platform_roles (user_id,role_id) SELECT $1,id FROM roles WHERE scope='PLATFORM' AND key='platform_owner'`, [ids.platformOwner]);
    await db.query(`INSERT INTO roles (id,scope,key,name,is_system,is_protected) VALUES ($1,'PLATFORM',$2,'Ticket viewer test',false,false),($3,'PLATFORM',$4,'Ticket reply-only test',false,false)`, [ids.viewRole, `ticket_viewer_${slug}`, ids.replyRole, `ticket_reply_only_${slug}`]);
    await db.query(`INSERT INTO role_permissions (role_id,permission_id) SELECT $1,id FROM permissions WHERE key='support.tickets.view'`, [ids.viewRole]);
    await db.query(`INSERT INTO role_permissions (role_id,permission_id) SELECT $1,id FROM permissions WHERE key='support.tickets.reply'`, [ids.replyRole]);
    await db.query(`INSERT INTO user_platform_roles (user_id,role_id) VALUES ($1,$2),($3,$4)`, [ids.viewOnly, ids.viewRole, ids.replyOnly, ids.replyRole]);

    const audit = new PlatformAuditService(db);
    const service = new SupportTicketsService(db, audit);
    const authorization = new AuthorizationService(db.getRepository(CoffeeShopMembership), db.getRepository(UserPlatformRole));
    assert.equal((await authorization.authorizeTenant(ids.tenantUserA, ids.tenantA, [TenantPermissions.SupportTicketsUse])).permitted, true);
    assert.equal(await authorization.hasPlatformPermissions(ids.platformReply, [PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsReply]), true);
    assert.equal(await authorization.hasPlatformPermissions(ids.platformReply, [PlatformPermissions.SupportTicketsManage]), false);
    assert.equal(await authorization.hasPlatformPermissions(ids.viewOnly, [PlatformPermissions.SupportTicketsView]), true);
    assert.equal(await authorization.hasPlatformPermissions(ids.viewOnly, [PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsReply]), false);
    assert.equal(await authorization.hasPlatformPermissions(ids.viewOnly, [PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsManage]), false);
    assert.equal(await authorization.hasPlatformPermissions(ids.replyOnly, [PlatformPermissions.SupportTicketsView]), true);
    assert.equal(await authorization.hasPlatformPermissions(ids.replyOnly, [PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsReply]), true);
    assert.ok((await authorization.getPlatformAccess(ids.replyOnly))?.permissions.includes(PlatformPermissions.SupportTicketsView));
    assert.equal(await authorization.hasPlatformPermissions(ids.replyOnly, [PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsReply, PlatformPermissions.SupportTicketsManage]), false);
    assert.equal(await authorization.hasPlatformPermissions(ids.platformOwner, [PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsReply, PlatformPermissions.SupportTicketsManage]), true);

    const initial = await service.create(ids.tenantA, ids.tenantUserA, { department: SupportTicketDepartment.Technical, subject: "Orders unavailable", message: "Checkout fails" });
    ticketIds.push(initial.id);
    assert.equal(initial.status, SupportTicketStatus.WaitingForPlatform);
    assert.equal(initial.messages.length, 1);
    assert.equal(initial.messages[0]?.senderType, "TENANT_USER");
    assert.match(initial.referenceNumber, /^UC-\d+$/);
    const creator = await db.query<Array<{ userId: string }>>(`SELECT created_by_user_id AS "userId" FROM support_tickets WHERE id=$1`, [initial.id]);
    const firstMessage = await db.query<Array<{ userId: string; body: string }>>(`SELECT sender_user_id AS "userId",body FROM support_ticket_messages WHERE ticket_id=$1`, [initial.id]);
    assert.equal(creator[0]?.userId, ids.tenantUserA);
    assert.deepEqual(firstMessage[0], { userId: ids.tenantUserA, body: "Checkout fails" });

    const other = await service.create(ids.tenantB, ids.tenantUserB, { department: SupportTicketDepartment.Sales, subject: "Pricing question", message: "Need a quote" });
    ticketIds.push(other.id);
    assert.equal((await service.listTenant(ids.tenantA, { page: 1, pageSize: 25 })).items.some((item) => item.id === other.id), false);
    const beforeCrossTenantReply = await db.query<Array<{ status: string; messages: string; updatedAt: Date }>>(
      `SELECT t.status,(SELECT count(*)::text FROM support_ticket_messages m WHERE m.ticket_id=t.id) AS messages,t.updated_at AS "updatedAt" FROM support_tickets t WHERE t.id=$1`, [other.id]);
    await assert.rejects(service.detailTenant(ids.tenantA, other.id), { status: 404 });
    await assert.rejects(service.replyTenant(ids.tenantA, other.id, ids.tenantUserA, { message: "Cross-tenant" }), { status: 404 });
    const untouched = await db.query<Array<{ status: string; messages: string; updatedAt: Date }>>(
      `SELECT t.status,(SELECT count(*)::text FROM support_ticket_messages m WHERE m.ticket_id=t.id) AS messages,t.updated_at AS "updatedAt" FROM support_tickets t WHERE t.id=$1`, [other.id]);
    assert.deepEqual(untouched[0], beforeCrossTenantReply[0]);

    const platformReply = await service.replyPlatform(initial.id, ids.platformReply, { message: "We are checking" });
    assert.equal(platformReply.status, SupportTicketStatus.WaitingForTenant);
    assert.ok(platformReply.lastPlatformReplyAt);
    const tenantReply = await service.replyTenant(ids.tenantA, initial.id, ids.tenantUserA, { message: "Thank you" });
    assert.equal(tenantReply.status, SupportTicketStatus.WaitingForPlatform);
    const senders = await db.query<Array<{ senderType: string; senderUserId: string }>>(`SELECT sender_type AS "senderType",sender_user_id AS "senderUserId" FROM support_ticket_messages WHERE ticket_id=$1 ORDER BY created_at,id`, [initial.id]);
    assert.deepEqual(senders.map((row) => [row.senderType, row.senderUserId]), [["TENANT_USER", ids.tenantUserA], ["PLATFORM_USER", ids.platformReply], ["TENANT_USER", ids.tenantUserA]]);

    const beforeRollback = await db.query<Array<{ count: string; status: string; lastMessageAt: Date }>>(`SELECT (SELECT count(*)::text FROM support_ticket_messages WHERE ticket_id=$1) AS count,status,last_message_at AS "lastMessageAt" FROM support_tickets WHERE id=$1`, [initial.id]);
    const mutableDb = db as unknown as { transaction: (callback: (manager: EntityManager) => Promise<unknown>) => Promise<unknown> };
    const originalTransaction = db.transaction.bind(db);
    mutableDb.transaction = (callback) => originalTransaction(async (manager) => { await callback(manager); throw new Error("injected transaction failure"); });
    try {
      await assert.rejects(service.replyTenant(ids.tenantA, initial.id, ids.tenantUserA, { message: "Must roll back" }), /injected transaction failure/);
    } finally { mutableDb.transaction = originalTransaction; }
    const afterRollback = await db.query<Array<{ count: string; status: string; lastMessageAt: Date }>>(`SELECT (SELECT count(*)::text FROM support_ticket_messages WHERE ticket_id=$1) AS count,status,last_message_at AS "lastMessageAt" FROM support_tickets WHERE id=$1`, [initial.id]);
    assert.deepEqual(afterRollback[0], beforeRollback[0]);

    const closed = await service.manage(initial.id, ids.platformOwner, { action: "CLOSE" });
    assert.equal(closed.status, SupportTicketStatus.Closed);
    assert.equal(closed.closeReason, "MANUAL");
    await assert.rejects(service.replyTenant(ids.tenantA, initial.id, ids.tenantUserA, { message: "Manual close" }), { status: 409 });
    const reopened = await service.manage(initial.id, ids.platformOwner, { action: "REOPEN" });
    assert.equal(reopened.status, SupportTicketStatus.WaitingForPlatform);
    assert.equal(reopened.closeReason, "MANUAL");
    const lastActivityBeforeMove = reopened.lastActivityAt;
    const lastReplyBeforeMove = reopened.lastPlatformReplyAt;
    const moved = await service.manage(initial.id, ids.platformOwner, { action: "CHANGE_DEPARTMENT", department: SupportTicketDepartment.Sales });
    assert.equal(moved.department, SupportTicketDepartment.Sales);
    assert.equal(moved.status, reopened.status);
    assert.equal(moved.lastActivityAt.getTime(), lastActivityBeforeMove.getTime());
    assert.equal(moved.lastPlatformReplyAt?.getTime(), lastReplyBeforeMove?.getTime());
    await assert.rejects(service.manage(initial.id, ids.platformOwner, { action: "CHANGE_DEPARTMENT", department: SupportTicketDepartment.Sales }), { status: 409 });
    const auditRows = await db.query<Array<{ action: string; targetId: string }>>(`SELECT action,target_id AS "targetId" FROM platform_audit_events WHERE target_type='support_ticket' AND target_id=$1 ORDER BY created_at`, [initial.id]);
    assert.deepEqual(auditRows.map((row) => row.action), ["support.ticket.closed", "support.ticket.reopened", "support.ticket.department_changed"]);

    await db.query(`UPDATE support_tickets SET status='CLOSED',close_reason='INACTIVITY',closed_at=clock_timestamp(),closed_by_user_id=NULL WHERE id=$1`, [initial.id]);
    const inactivityReply = await service.replyTenant(ids.tenantA, initial.id, ids.tenantUserA, { message: "Following up" });
    assert.equal(inactivityReply.status, SupportTicketStatus.WaitingForPlatform);
    assert.equal(inactivityReply.closeReason, "INACTIVITY");

    const concurrent = await Promise.all(Array.from({ length: 10 }, (_, i) => service.create(ids.tenantA, ids.tenantUserA, {
      department: SupportTicketDepartment.Technical, subject: `Concurrent ticket ${i}`, message: "Concurrent creation",
    })));
    ticketIds.push(...concurrent.map((ticket) => ticket.id));
    const references = await db.query<Array<{ referenceNumber: string }>>(`SELECT reference_number AS "referenceNumber" FROM support_tickets WHERE id=ANY($1::uuid[])`, [concurrent.map((ticket) => ticket.id)]);
    assert.equal(new Set(references.map((row) => row.referenceNumber)).size, references.length);

    const queue = await service.listPlatform({ page: 1, pageSize: 100, tenantId: ids.tenantA, department: SupportTicketDepartment.Technical });
    assert.equal(queue.items.every((item) => item.tenantId === ids.tenantA && item.department === "TECHNICAL"), true);
    const salesQueue = await service.listPlatform({ page: 1, pageSize: 100, tenantId: ids.tenantB, department: SupportTicketDepartment.Sales });
    assert.equal(salesQueue.items.length > 0 && salesQueue.items.every((item) => item.tenantId === ids.tenantB && item.department === "SALES"), true);
    const waitingQueue = await service.listPlatform({ page: 1, pageSize: 100, status: SupportTicketStatus.WaitingForPlatform });
    assert.equal(waitingQueue.items.length > 0 && waitingQueue.items.every((item) => item.status === SupportTicketStatus.WaitingForPlatform), true);
    const byReference = await service.listPlatform({ page: 1, pageSize: 10, referenceNumber: initial.referenceNumber.toLowerCase() });
    assert.equal(byReference.items[0]?.id, initial.id);
    const bySubject = await service.listPlatform({ page: 1, pageSize: 10, search: "ORDERS" });
    assert.equal(bySubject.items.some((item) => item.id === initial.id), true);
    const byTenantName = await service.listPlatform({ page: 1, pageSize: 10, search: "fixture b" });
    assert.equal(byTenantName.items.some((item) => item.id === other.id), true);
    const byTenantFilter = await service.listPlatform({ page: 1, pageSize: 100, tenantSearch: "ticket-a-" });
    assert.equal(byTenantFilter.items.length > 0 && byTenantFilter.items.every((item) => item.tenantId === ids.tenantA), true);
    const firstPage = await service.listPlatform({ page: 1, pageSize: 5, search: "Concurrent ticket" });
    const secondPage = await service.listPlatform({ page: 2, pageSize: 5, search: "Concurrent ticket" });
    assert.equal(Number(firstPage.total), 10);
    assert.equal(firstPage.items.length, 5);
    assert.equal(secondPage.items.length, 5);
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size, 10);
    assert.equal((await service.detailPlatform(other.id)).tenant.id, ids.tenantB);

    const raced = await service.create(ids.tenantA, ids.tenantUserA, { department: SupportTicketDepartment.Technical, subject: "Concurrent replies", message: "Started" });
    ticketIds.push(raced.id);
    await Promise.all([
      service.replyPlatform(raced.id, ids.platformReply, { message: "Platform raced" }),
      service.replyTenant(ids.tenantA, raced.id, ids.tenantUserA, { message: "Tenant raced" }),
    ]);
    const tail = await db.query<Array<{ senderType: string }>>(`SELECT sender_type AS "senderType" FROM support_ticket_messages WHERE ticket_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [raced.id]);
    const final = await service.detailTenant(ids.tenantA, raced.id);
    assert.equal(final.status, tail[0]?.senderType === "PLATFORM_USER" ? SupportTicketStatus.WaitingForTenant : SupportTicketStatus.WaitingForPlatform);

    const closeRace = await service.create(ids.tenantA, ids.tenantUserA, { department: SupportTicketDepartment.Technical, subject: "Reply-close race", message: "Started" });
    ticketIds.push(closeRace.id);
    const raceResults = await Promise.allSettled([
      service.replyTenant(ids.tenantA, closeRace.id, ids.tenantUserA, { message: "Reply raced with close" }),
      service.manage(closeRace.id, ids.platformOwner, { action: "CLOSE" }),
    ]);
    assert.equal(raceResults[1]?.status, "fulfilled");
    const raceState = await db.query<Array<{ status: string; closeReason: string; messageCount: string }>>(
      `SELECT t.status,t.close_reason AS "closeReason",(SELECT count(*)::text FROM support_ticket_messages m WHERE m.ticket_id=t.id) AS "messageCount" FROM support_tickets t WHERE t.id=$1`, [closeRace.id]);
    assert.equal(raceState[0]?.status, "CLOSED");
    assert.equal(raceState[0]?.closeReason, "MANUAL");
    assert.equal(raceState[0]?.messageCount, raceResults[0]?.status === "fulfilled" ? "2" : "1");
  } finally {
    if (db.isInitialized) {
      if (ticketIds.length) {
        await db.query(`DELETE FROM platform_audit_events WHERE target_type='support_ticket' AND target_id=ANY($1::text[])`, [ticketIds]);
        await db.query(`DELETE FROM support_ticket_messages WHERE ticket_id=ANY($1::uuid[])`, [ticketIds]);
        await db.query(`DELETE FROM support_tickets WHERE id=ANY($1::uuid[])`, [ticketIds]);
      }
      await db.query(`DELETE FROM user_platform_roles WHERE user_id=ANY($1::uuid[])`, [[ids.platformReply, ids.platformOwner, ids.viewOnly, ids.replyOnly]]);
      await db.query(`DELETE FROM roles WHERE id=ANY($1::uuid[])`, [[ids.viewRole, ids.replyRole]]);
      await db.query(`DELETE FROM membership_roles WHERE membership_id IN (SELECT id FROM coffee_shop_memberships WHERE coffee_shop_id=ANY($1::uuid[]))`, [[ids.tenantA, ids.tenantB]]);
      await db.query(`DELETE FROM coffee_shop_memberships WHERE coffee_shop_id=ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]);
      await db.query(`DELETE FROM platform_audit_events WHERE actor_user_id=ANY($1::uuid[])`, [[ids.platformReply, ids.platformOwner, ids.viewOnly, ids.tenantUserA, ids.tenantUserB]]);
      await db.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[ids.tenantUserA, ids.tenantUserB, ids.platformReply, ids.platformOwner, ids.viewOnly, ids.replyOnly]]);
      await db.query(`DELETE FROM coffee_shops WHERE id=ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]);
      await db.destroy();
    }
  }
});
