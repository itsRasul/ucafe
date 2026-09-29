import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { DataSource, EntityManager } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { PlatformAuditService } from "../audit/platform-audit.service";
import { Branch, CoffeeShop, Domain } from "../database/entities";
import { CoffeeShopMembership, MembershipRole, Permission, Role, User, UserPlatformRole } from "../identity/entities";
import { AuthorizationService } from "../authorization/authorization.service";
import { PlatformPermissions, TenantPermissions } from "../authorization/permission.constants";
import { NotificationDelivery } from "../notifications/entities";
import { NotificationType } from "../notifications/notification-type";
import { NotificationsService } from "../notifications/notifications.service";
import { SmsProvider } from "../auth/sms-provider";
import { SupportTicket, SupportTicketAttachment, SupportTicketMessage, SupportTicketDepartment, SupportTicketStatus } from "./entities";
import { SupportTicketNotificationsService } from "./support-ticket-notifications.service";
import { SupportTicketsService, SUPPORT_TICKET_AUTO_CLOSE_BATCH_SIZE, SUPPORT_TICKET_INACTIVITY_MS } from "./support-tickets.service";
import { MediaStorageService } from "../media/media-storage.service";

const integrationUrl = process.env.TICKETING_INTEGRATION_DATABASE_URL;
const entities = [CoffeeShop, Branch, Domain, User, CoffeeShopMembership, MembershipRole, Role, Permission, UserPlatformRole, SupportTicket, SupportTicketMessage, SupportTicketAttachment, NotificationDelivery];

class MemoryTicketStorage {
  objects = new Map<string, Buffer>();
  failPut = false;
  putCalls = 0;
  failPutAtCall?: number;
  async putObject(key: string, body: Buffer) {
    this.putCalls += 1;
    if (this.failPut || this.putCalls === this.failPutAtCall) throw new Error("simulated storage outage");
    this.objects.set(key, body);
  }
  async getObject(key: string) { const body = this.objects.get(key); if (!body) throw new Error("missing object"); return { body: Readable.from(body), contentLength: body.length }; }
  async removeObject(key: string) { this.objects.delete(key); }
}

const pdfFile = (name = "support.pdf") => {
  const buffer = Buffer.from("%PDF-1.7\nUCafe test attachment\n");
  return { originalname: name, mimetype: "application/pdf", size: buffer.length, buffer } as Express.Multer.File;
};

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
    const storage = new MemoryTicketStorage();
    const config = new ConfigService({ AUTH_PEPPER: "test-only-auth-pepper-with-at-least-32-characters", PII_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), SMS_PROVIDER: "development" });
    const crypto = new AuthCryptoService(config);
    const notifications = new NotificationsService(db, crypto, config, { sendTemplate: async () => ({ providerMessageId: "test" }) } as unknown as SmsProvider);
    const ticketNotifications = new SupportTicketNotificationsService(notifications);
    const service = new SupportTicketsService(db, audit, storage as unknown as MediaStorageService, ticketNotifications);
    const userPhones = new Map([[ids.tenantUserA, "+989120000001"], [ids.tenantUserB, "+989120000002"], [ids.platformReply, "+989120000003"], [ids.platformOwner, "+989120000004"], [ids.viewOnly, "+989120000005"], [ids.replyOnly, "+989120000006"]]);
    for (const [userId, phone] of userPhones) await db.query(`UPDATE users SET phone=$2,phone_verified_at=now() WHERE id=$1`, [userId, phone]);
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

    const initial = await service.create(ids.tenantA, ids.tenantUserA, { department: SupportTicketDepartment.Technical, subject: "Orders unavailable", message: "Checkout fails" }, [pdfFile("../../initial.pdf"), pdfFile("second-initial.pdf")]);
    ticketIds.push(initial.id);
    assert.equal(initial.status, SupportTicketStatus.WaitingForPlatform);
    assert.equal(initial.messages.length, 1);
    assert.equal(initial.messages[0]?.senderType, "TENANT_USER");
    assert.equal(initial.messages[0]?.attachments?.length, 2);
    assert.equal(initial.messages[0]?.attachments?.[0]?.originalFilename, "initial.pdf");
    assert.equal("storageKey" in (initial.messages[0]?.attachments?.[0] ?? {}), false);
    assert.match(initial.referenceNumber, /^UC-\d+$/);
    const createdDeliveries = await db.query<Array<{ type: string; payload: Record<string, string>; recipientCiphertext: string }>>(
      `SELECT type,payload,recipient_ciphertext AS "recipientCiphertext" FROM notification_deliveries WHERE related_entity_type='support_ticket' AND related_entity_id=$1`, [initial.id]);
    assert.equal(createdDeliveries.length, 3);
    assert.ok(createdDeliveries.every((row) => row.type === NotificationType.TicketCreated && row.payload.ticketReference === initial.referenceNumber && row.payload.department === "فنی"));
    assert.ok(createdDeliveries.every((row) => !JSON.stringify(row.payload).includes("Checkout fails") && !JSON.stringify(row.payload).includes(initial.id)));
    assert.deepEqual(createdDeliveries.map((row) => crypto.decryptPhone(row.recipientCiphertext)).sort(), [userPhones.get(ids.platformReply), userPhones.get(ids.platformOwner), userPhones.get(ids.replyOnly)].sort());
    assert.equal(createdDeliveries.some((row) => crypto.decryptPhone(row.recipientCiphertext) === userPhones.get(ids.viewOnly)), false);
    const initialAttachmentId = initial.messages[0]!.attachments![0]!.id;
    const initialDownload = await service.streamTenantAttachment(ids.tenantA, initial.id, initialAttachmentId);
    const chunks: Buffer[] = [];
    for await (const chunk of initialDownload.body) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString(), "%PDF-1.7\nUCafe test attachment\n");
    await assert.rejects(service.streamTenantAttachment(ids.tenantB, initial.id, initialAttachmentId), { status: 404 });
    const creator = await db.query<Array<{ userId: string }>>(`SELECT created_by_user_id AS "userId" FROM support_tickets WHERE id=$1`, [initial.id]);
    const firstMessage = await db.query<Array<{ userId: string; body: string }>>(`SELECT sender_user_id AS "userId",body FROM support_ticket_messages WHERE ticket_id=$1`, [initial.id]);
    assert.equal(creator[0]?.userId, ids.tenantUserA);
    assert.deepEqual(firstMessage[0], { userId: ids.tenantUserA, body: "Checkout fails" });

    const other = await service.create(ids.tenantB, ids.tenantUserB, { department: SupportTicketDepartment.Sales, subject: "Pricing question", message: "Need a quote" });
    ticketIds.push(other.id);
    await assert.rejects(service.streamTenantAttachment(ids.tenantA, other.id, initialAttachmentId), { status: 404 });
    assert.equal((await service.listTenant(ids.tenantA, { page: 1, pageSize: 25 })).items.some((item) => item.id === other.id), false);
    const beforeCrossTenantReply = await db.query<Array<{ status: string; messages: string; updatedAt: Date }>>(
      `SELECT t.status,(SELECT count(*)::text FROM support_ticket_messages m WHERE m.ticket_id=t.id) AS messages,t.updated_at AS "updatedAt" FROM support_tickets t WHERE t.id=$1`, [other.id]);
    await assert.rejects(service.detailTenant(ids.tenantA, other.id), { status: 404 });
    await assert.rejects(service.replyTenant(ids.tenantA, other.id, ids.tenantUserA, { message: "Cross-tenant" }), { status: 404 });
    const crossTenantNotifications = await db.query<Array<{ total: string }>>(`SELECT count(*)::text AS total FROM notification_deliveries WHERE related_entity_type='support_ticket' AND related_entity_id=$1 AND type=$2`, [other.id, NotificationType.TicketTenantReplied]);
    assert.equal(crossTenantNotifications[0]?.total, "0");
    const untouched = await db.query<Array<{ status: string; messages: string; updatedAt: Date }>>(
      `SELECT t.status,(SELECT count(*)::text FROM support_ticket_messages m WHERE m.ticket_id=t.id) AS messages,t.updated_at AS "updatedAt" FROM support_tickets t WHERE t.id=$1`, [other.id]);
    assert.deepEqual(untouched[0], beforeCrossTenantReply[0]);

    const platformReply = await service.replyPlatform(initial.id, ids.platformReply, { message: "We are checking" }, [pdfFile("platform-reply-1.pdf"), pdfFile("platform-reply-2.pdf")]);
    assert.equal(platformReply.status, SupportTicketStatus.WaitingForTenant);
    assert.ok(platformReply.lastPlatformReplyAt);
    assert.equal(platformReply.messages[1]?.attachments?.length, 2);
    const platformReplyDeliveries = await db.query<Array<{ payload: Record<string, string>; recipientCiphertext: string }>>(
      `SELECT payload,recipient_ciphertext AS "recipientCiphertext" FROM notification_deliveries WHERE related_entity_type='support_ticket' AND related_entity_id=$1 AND type=$2`,
      [initial.id, NotificationType.TicketPlatformReplied]);
    assert.equal(platformReplyDeliveries.length, 1);
    assert.deepEqual(platformReplyDeliveries[0]?.payload, { ticketReference: initial.referenceNumber });
    assert.equal(crypto.decryptPhone(platformReplyDeliveries[0]!.recipientCiphertext), userPhones.get(ids.tenantUserA));
    const platformAttachmentId = platformReply.messages[1]!.attachments![0]!.id;
    assert.equal((await service.streamPlatformAttachment(initial.id, platformAttachmentId)).contentType, "application/pdf");
    const tenantReply = await service.replyTenant(ids.tenantA, initial.id, ids.tenantUserA, { message: "Thank you" }, [pdfFile("tenant-reply.pdf")]);
    assert.equal(tenantReply.status, SupportTicketStatus.WaitingForPlatform);
    assert.equal(tenantReply.messages[2]?.attachments?.length, 1);
    const tenantReplyDeliveries = await db.query<Array<{ type: string; deduplicationKey: string }>>(
      `SELECT type,deduplication_key AS "deduplicationKey" FROM notification_deliveries WHERE related_entity_type='support_ticket' AND related_entity_id=$1 AND type=$2`,
      [initial.id, NotificationType.TicketTenantReplied]);
    assert.equal(tenantReplyDeliveries.length, 3);
    assert.equal(new Set(tenantReplyDeliveries.map((row) => row.deduplicationKey)).size, 3);
    const senders = await db.query<Array<{ senderType: string; senderUserId: string }>>(`SELECT sender_type AS "senderType",sender_user_id AS "senderUserId" FROM support_ticket_messages WHERE ticket_id=$1 ORDER BY created_at,id`, [initial.id]);
    assert.deepEqual(senders.map((row) => [row.senderType, row.senderUserId]), [["TENANT_USER", ids.tenantUserA], ["PLATFORM_USER", ids.platformReply], ["TENANT_USER", ids.tenantUserA]]);

    const beforeRollback = await db.query<Array<{ count: string; status: string; lastMessageAt: Date }>>(`SELECT (SELECT count(*)::text FROM support_ticket_messages WHERE ticket_id=$1) AS count,status,last_message_at AS "lastMessageAt" FROM support_tickets WHERE id=$1`, [initial.id]);
    const tenantNoticesBeforeRollback = await db.query<Array<{ total: string }>>(`SELECT count(*)::text AS total FROM notification_deliveries WHERE related_entity_id=$1 AND type=$2`, [initial.id, NotificationType.TicketTenantReplied]);
    const mutableDb = db as unknown as { transaction: (callback: (manager: EntityManager) => Promise<unknown>) => Promise<unknown> };
    const originalTransaction = db.transaction.bind(db);
    mutableDb.transaction = (callback) => originalTransaction(async (manager) => { await callback(manager); throw new Error("injected transaction failure"); });
    try {
      await assert.rejects(service.replyTenant(ids.tenantA, initial.id, ids.tenantUserA, { message: "Must roll back" }, [pdfFile("rollback.pdf")]), /injected transaction failure/);
    } finally { mutableDb.transaction = originalTransaction; }
    const afterRollback = await db.query<Array<{ count: string; status: string; lastMessageAt: Date }>>(`SELECT (SELECT count(*)::text FROM support_ticket_messages WHERE ticket_id=$1) AS count,status,last_message_at AS "lastMessageAt" FROM support_tickets WHERE id=$1`, [initial.id]);
    assert.deepEqual(afterRollback[0], beforeRollback[0]);
    const tenantNoticesAfterRollback = await db.query<Array<{ total: string }>>(`SELECT count(*)::text AS total FROM notification_deliveries WHERE related_entity_id=$1 AND type=$2`, [initial.id, NotificationType.TicketTenantReplied]);
    assert.deepEqual(tenantNoticesAfterRollback, tenantNoticesBeforeRollback);
    assert.equal(storage.objects.size, 5);

    const beforeStorageFailure = await db.query<Array<{ count: string; status: string }>>(`SELECT (SELECT count(*)::text FROM support_ticket_messages WHERE ticket_id=$1) AS count,status FROM support_tickets WHERE id=$1`, [initial.id]);
    storage.failPut = true;
    await assert.rejects(service.replyPlatform(initial.id, ids.platformReply, { message: "Storage failed" }, [pdfFile("failed.pdf")]), { status: 503 });
    storage.failPut = false;
    const afterStorageFailure = await db.query<Array<{ count: string; status: string }>>(`SELECT (SELECT count(*)::text FROM support_ticket_messages WHERE ticket_id=$1) AS count,status FROM support_tickets WHERE id=$1`, [initial.id]);
    assert.deepEqual(afterStorageFailure[0], beforeStorageFailure[0]);
    assert.equal(storage.objects.size, 5);

    const beforePartialUploadFailure = await db.query<Array<{ count: string; status: string }>>(`SELECT (SELECT count(*)::text FROM support_ticket_messages WHERE ticket_id=$1) AS count,status FROM support_tickets WHERE id=$1`, [initial.id]);
    storage.failPutAtCall = storage.putCalls + 3;
    await assert.rejects(service.replyPlatform(initial.id, ids.platformReply, { message: "Partial storage failure" }, [pdfFile("partial-1.pdf"), pdfFile("partial-2.pdf"), pdfFile("partial-3.pdf")]), { status: 503 });
    storage.failPutAtCall = undefined;
    const afterPartialUploadFailure = await db.query<Array<{ count: string; status: string }>>(`SELECT (SELECT count(*)::text FROM support_ticket_messages WHERE ticket_id=$1) AS count,status FROM support_tickets WHERE id=$1`, [initial.id]);
    assert.deepEqual(afterPartialUploadFailure[0], beforePartialUploadFailure[0]);
    assert.equal(storage.objects.size, 5);

    await db.query(`UPDATE users SET phone_verified_at=NULL WHERE id=$1`, [ids.tenantUserB]);
    const replyToTicketWithUnverifiedCreator = await service.replyPlatform(other.id, ids.platformReply, { message: "Ticket update" });
    assert.equal(replyToTicketWithUnverifiedCreator.status, SupportTicketStatus.WaitingForTenant);
    const skippedTenantNotice = await db.query<Array<{ total: string }>>(
      `SELECT count(*)::text AS total FROM notification_deliveries WHERE related_entity_id=$1 AND type=$2`, [other.id, NotificationType.TicketPlatformReplied]);
    assert.equal(skippedTenantNotice[0]?.total, "0");

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

    const sweepNow = new Date();
    const makeStaleWaitingTicket = async (subject: string, ageMs = SUPPORT_TICKET_INACTIVITY_MS) => {
      const created = await service.create(ids.tenantA, ids.tenantUserA, { department: SupportTicketDepartment.Technical, subject, message: "Initial" });
      ticketIds.push(created.id);
      await service.replyPlatform(created.id, ids.platformReply, { message: "Platform response" });
      await db.query(`UPDATE support_tickets SET last_platform_reply_at=$2 WHERE id=$1`, [created.id, new Date(sweepNow.getTime() - ageMs)]);
      return created;
    };
    const eligible = await makeStaleWaitingTicket("Eligible for inactivity close");
    const almostEligible = await makeStaleWaitingTicket("Just under the cutoff", SUPPORT_TICKET_INACTIVITY_MS - 60_000);
    const tenantReplied = await makeStaleWaitingTicket("Tenant replied after old response");
    await service.replyTenant(ids.tenantA, tenantReplied.id, ids.tenantUserA, { message: "Tenant replied" });
    await db.query(`UPDATE support_tickets SET last_platform_reply_at=$2 WHERE id=$1`, [tenantReplied.id, new Date(sweepNow.getTime() - SUPPORT_TICKET_INACTIVITY_MS - 60_000)]);
    const manuallyClosed = await makeStaleWaitingTicket("Manual closure stays manual");
    const manualState = await service.manage(manuallyClosed.id, ids.platformOwner, { action: "CLOSE" });
    const metadataUpdated = await makeStaleWaitingTicket("Metadata does not reset inactivity");
    await service.manage(metadataUpdated.id, ids.platformOwner, { action: "CHANGE_DEPARTMENT", department: SupportTicketDepartment.Sales });
    await db.query(`UPDATE support_tickets SET updated_at=clock_timestamp() WHERE id=$1`, [metadataUpdated.id]);
    const waitingForPlatform = await makeStaleWaitingTicket("Old reply with newer tenant message");
    await service.replyTenant(ids.tenantA, waitingForPlatform.id, ids.tenantUserA, { message: "Newer tenant reply" });
    await db.query(`UPDATE support_tickets SET last_platform_reply_at=$2 WHERE id=$1`, [waitingForPlatform.id, new Date(sweepNow.getTime() - SUPPORT_TICKET_INACTIVITY_MS - 60_000)]);
    const notificationCountBeforeClose = await db.query<Array<{ total: string }>>(
      `SELECT count(*)::text AS total FROM notification_deliveries WHERE related_entity_type='support_ticket' AND related_entity_id=$1`, [eligible.id]);
    const beforeAutoCloseMessages = await db.query<Array<{ total: string }>>(`SELECT count(*)::text AS total FROM support_ticket_messages WHERE ticket_id=$1`, [eligible.id]);

    assert.equal(SUPPORT_TICKET_AUTO_CLOSE_BATCH_SIZE, 100);
    const closeResult = await service.autoCloseInactiveTickets(sweepNow);
    assert.deepEqual(closeResult, { candidates: 2, closed: 2, skipped: 0, failed: 0 });
    const autoClosed = await service.detailTenant(ids.tenantA, eligible.id);
    assert.equal(autoClosed.status, SupportTicketStatus.Closed);
    assert.equal(autoClosed.closeReason, "INACTIVITY");
    assert.ok(autoClosed.closedAt);
    const untouchedStatuses = await db.query<Array<{ id: string; status: string; closeReason: string | null; closedAt: Date | null; lastPlatformReplyAt: Date | null; updatedAt: Date }>>(
      `SELECT id,status,close_reason AS "closeReason",closed_at AS "closedAt",last_platform_reply_at AS "lastPlatformReplyAt",updated_at AS "updatedAt"
       FROM support_tickets WHERE id=ANY($1::uuid[])`, [[almostEligible.id, tenantReplied.id, manuallyClosed.id, metadataUpdated.id, waitingForPlatform.id]]);
    const byId = new Map(untouchedStatuses.map((row) => [row.id, row]));
    assert.equal(byId.get(almostEligible.id)?.status, SupportTicketStatus.WaitingForTenant);
    assert.equal(byId.get(tenantReplied.id)?.status, SupportTicketStatus.WaitingForPlatform);
    assert.equal(byId.get(waitingForPlatform.id)?.status, SupportTicketStatus.WaitingForPlatform);
    assert.equal(byId.get(manuallyClosed.id)?.closeReason, "MANUAL");
    assert.equal(byId.get(manuallyClosed.id)?.closedAt?.getTime(), manualState.closedAt?.getTime());
    assert.equal(byId.get(metadataUpdated.id)?.status, SupportTicketStatus.Closed);
    assert.ok(byId.get(metadataUpdated.id)?.lastPlatformReplyAt && byId.get(metadataUpdated.id)!.lastPlatformReplyAt! <= new Date(sweepNow.getTime() - SUPPORT_TICKET_INACTIVITY_MS));
    assert.ok(byId.get(metadataUpdated.id)!.updatedAt > new Date(sweepNow.getTime() - SUPPORT_TICKET_INACTIVITY_MS));
    const messagesAfterClose = await db.query<Array<{ total: string }>>(`SELECT count(*)::text AS total FROM support_ticket_messages WHERE ticket_id=$1`, [eligible.id]);
    const notificationsAfterClose = await db.query<Array<{ total: string }>>(
      `SELECT count(*)::text AS total FROM notification_deliveries WHERE related_entity_type='support_ticket' AND related_entity_id=$1`, [eligible.id]);
    assert.deepEqual(messagesAfterClose, beforeAutoCloseMessages);
    assert.deepEqual(notificationsAfterClose, notificationCountBeforeClose);
    await assert.rejects(service.replyTenant(ids.tenantA, manuallyClosed.id, ids.tenantUserA, { message: "Cannot reply to manual close" }), { status: 409 });

    const firstClosedAt = autoClosed.closedAt;
    assert.deepEqual(await service.autoCloseInactiveTickets(sweepNow), { candidates: 0, closed: 0, skipped: 0, failed: 0 });
    assert.equal((await service.detailTenant(ids.tenantA, eligible.id)).closedAt?.getTime(), firstClosedAt?.getTime());
    const autoReopen = await service.replyTenant(ids.tenantA, eligible.id, ids.tenantUserA, { message: "Continue the conversation" }, [pdfFile("reopened.pdf")]);
    assert.equal(autoReopen.status, SupportTicketStatus.WaitingForPlatform);
    assert.equal(autoReopen.closeReason, "INACTIVITY");
    assert.equal(autoReopen.messages.length, Number(beforeAutoCloseMessages[0]?.total) + 1);
    assert.equal(autoReopen.messages.at(-1)?.attachments?.length, 1);
    const reopenedNotices = await db.query<Array<{ deduplicationKey: string }>>(
      `SELECT deduplication_key AS "deduplicationKey" FROM notification_deliveries WHERE related_entity_type='support_ticket' AND related_entity_id=$1 AND type=$2`,
      [eligible.id, NotificationType.TicketTenantReplied]);
    assert.equal(reopenedNotices.length, 3);
    assert.equal(new Set(reopenedNotices.map((row) => row.deduplicationKey)).size, 3);

    const replyCloseRace = await makeStaleWaitingTicket("Tenant reply races inactivity close");
    const raceNow = new Date();
    await db.query(`UPDATE support_tickets SET last_platform_reply_at=$2 WHERE id=$1`, [replyCloseRace.id, new Date(raceNow.getTime() - SUPPORT_TICKET_INACTIVITY_MS - 1_000)]);
    const [raceSweep] = await Promise.all([
      service.autoCloseInactiveTickets(raceNow),
      service.replyTenant(ids.tenantA, replyCloseRace.id, ids.tenantUserA, { message: "Concurrent tenant response" }),
    ]);
    const replyRaceFinal = await service.detailTenant(ids.tenantA, replyCloseRace.id);
    assert.equal(replyRaceFinal.status, SupportTicketStatus.WaitingForPlatform);
    assert.equal(replyRaceFinal.messages.at(-1)?.senderType, "TENANT_USER");
    assert.ok(raceSweep!.closed === 0 || raceSweep!.closed === 1);

    const twoWorkerTicket = await makeStaleWaitingTicket("Two workers close once");
    const workerNow = new Date();
    await db.query(`UPDATE support_tickets SET last_platform_reply_at=$2 WHERE id=$1`, [twoWorkerTicket.id, new Date(workerNow.getTime() - SUPPORT_TICKET_INACTIVITY_MS - 1_000)]);
    const workerResults = await Promise.all([service.autoCloseInactiveTickets(workerNow), service.autoCloseInactiveTickets(workerNow)]);
    assert.equal(workerResults[0].closed + workerResults[1].closed, 1);
    assert.equal((await service.detailTenant(ids.tenantA, twoWorkerTicket.id)).status, SupportTicketStatus.Closed);

    const failedCandidate = await makeStaleWaitingTicket("One worker candidate fails");
    const nextCandidate = await makeStaleWaitingTicket("Worker continues after failure");
    const mutableService = service as unknown as { lockTicket: (manager: EntityManager, ticketId: string, coffeeShopId?: string) => Promise<unknown> };
    const originalLockTicket = mutableService.lockTicket;
    mutableService.lockTicket = async (manager, ticketId, coffeeShopId) => {
      if (ticketId === failedCandidate.id) throw new Error("Injected candidate failure");
      return originalLockTicket.call(service, manager, ticketId, coffeeShopId);
    };
    let failureSweep: Awaited<ReturnType<SupportTicketsService["autoCloseInactiveTickets"]>>;
    try { failureSweep = await service.autoCloseInactiveTickets(new Date()); }
    finally { mutableService.lockTicket = originalLockTicket; }
    assert.equal(failureSweep!.failed, 1);
    assert.equal(failureSweep!.closed, 1);
    assert.equal((await service.detailTenant(ids.tenantA, failedCandidate.id)).status, SupportTicketStatus.WaitingForTenant);
    assert.equal((await service.detailTenant(ids.tenantA, nextCandidate.id)).status, SupportTicketStatus.Closed);
  } finally {
    if (db.isInitialized) {
      if (ticketIds.length) {
        await db.query(`DELETE FROM platform_audit_events WHERE target_type='support_ticket' AND target_id=ANY($1::text[])`, [ticketIds]);
        await db.query(`DELETE FROM support_ticket_attachments WHERE ticket_message_id IN (SELECT id FROM support_ticket_messages WHERE ticket_id=ANY($1::uuid[]))`, [ticketIds]);
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
