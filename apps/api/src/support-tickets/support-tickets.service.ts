import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { PlatformAuditService } from "../audit/platform-audit.service";
import { MediaStorageService } from "../media/media-storage.service";
import { SupportTicketNotificationsService } from "./support-ticket-notifications.service";
import { CreateSupportTicketDto, CreateSupportTicketMessageDto, PlatformSupportTicketListQueryDto, TenantSupportTicketListQueryDto, UpdateSupportTicketDto } from "./dto/support-ticket.dto";
import { SupportTicketCloseReason, SupportTicketDepartment, SupportTicketSenderType, SupportTicketStatus } from "./entities";
import { inspectSupportTicketAttachments, SupportTicketAttachmentMimeType } from "./support-ticket-attachment.util";

type StoredTicketAttachment = { storageKey: string; originalFilename: string; detectedMimeType: SupportTicketAttachmentMimeType; sizeBytes: number };
type TicketMessageRow = { id: string; senderType: SupportTicketSenderType; body: string; createdAt: Date };

type TicketRow = {
  id: string; referenceNumber: string; coffeeShopId: string; createdByUserId: string; subject: string;
  department: SupportTicketDepartment; status: SupportTicketStatus; closeReason: SupportTicketCloseReason | null;
  closedAt: Date | null; closedByUserId: string | null; lastMessageAt: Date; lastMessageSenderType: SupportTicketSenderType;
  lastPlatformReplyAt: Date | null; tenantLastReadAt: Date | null; platformLastReadAt: Date | null; createdAt: Date; updatedAt: Date;
};

export const SUPPORT_TICKET_INACTIVITY_MS = 48 * 60 * 60 * 1_000;
export const SUPPORT_TICKET_AUTO_CLOSE_BATCH_SIZE = 100;
export const SUPPORT_TICKET_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1_000;
const SUPPORT_TICKET_ORPHAN_TENANTS_PER_SWEEP = 25;

function storageFailureCode(error: unknown) {
  const value = error && typeof error === "object" ? error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } : {};
  const name = (typeof value.name === "string" ? value.name : "StorageError").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48) || "StorageError";
  const status = value.$metadata?.httpStatusCode;
  return Number.isInteger(status) ? `${name}_HTTP_${status}` : name;
}

const ticketColumns = `t.id, t.reference_number AS "referenceNumber", t.coffee_shop_id AS "coffeeShopId",
  t.created_by_user_id AS "createdByUserId", t.subject, t.department, t.status, t.close_reason AS "closeReason",
  t.closed_at AS "closedAt", t.closed_by_user_id AS "closedByUserId", t.last_message_at AS "lastMessageAt",
  t.last_message_sender_type AS "lastMessageSenderType", t.last_platform_reply_at AS "lastPlatformReplyAt",
  t.tenant_last_read_at AS "tenantLastReadAt", t.platform_last_read_at AS "platformLastReadAt",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt"`;

@Injectable()
export class SupportTicketsService {
  private readonly logger = new Logger(SupportTicketsService.name);
  // ponytail: process-local cursor can rescan after restarts; persist it if object volume makes cleanup lag.
  private orphanSweepCursor: { afterCoffeeShopId?: string; coffeeShopId?: string; continuationToken?: string } = {};

  constructor(
    private readonly db: DataSource,
    private readonly audit: PlatformAuditService,
    private readonly storage: MediaStorageService,
    private readonly notifications: SupportTicketNotificationsService,
  ) {}

  async create(coffeeShopId: string, userId: string, input: CreateSupportTicketDto, files: Express.Multer.File[] = []) {
    const ticketId = randomUUID();
    const messageId = randomUUID();
    const attachments = await this.storeAttachments(coffeeShopId, ticketId, messageId, files);
    return this.withStorageCompensation(attachments, ticketId, "create", () => this.db.transaction(async (manager) => {
      const [ticket] = await manager.query<Array<{ referenceNumber: string }>>(
        `INSERT INTO support_tickets (id,coffee_shop_id,created_by_user_id,subject,department)
         VALUES ($1,$2,$3,$4,$5) RETURNING reference_number AS "referenceNumber"`,
        [ticketId, coffeeShopId, userId, input.subject, input.department],
      );
      const [message] = await manager.query<Array<{ createdAt: Date }>>(
        `INSERT INTO support_ticket_messages (id,coffee_shop_id,ticket_id,sender_user_id,sender_type,body)
         VALUES ($1,$2,$3,$4,'TENANT_USER',$5) RETURNING created_at AS "createdAt"`,
        [messageId, coffeeShopId, ticketId, userId, input.message],
      );
      await this.persistAttachments(manager, coffeeShopId, messageId, attachments);
      await manager.query(
        `UPDATE support_tickets SET last_message_at=$2,last_message_sender_type='TENANT_USER',tenant_last_read_at=$2,updated_at=$2 WHERE id=$1`,
        [ticketId, message!.createdAt],
      );
      await this.notifications.created(manager, { id: ticketId, coffeeShopId, referenceNumber: ticket!.referenceNumber, department: input.department });
      return this.tenantDetail(manager, coffeeShopId, ticketId);
    }));
  }

  async listTenant(coffeeShopId: string, query: TenantSupportTicketListQueryDto) {
    const params: unknown[] = [coffeeShopId];
    const statusClause = query.status ? ` AND t.status=$${params.push(query.status)}` : "";
    const [countRows, items] = await Promise.all([
      this.db.query<Array<{ total: string }>>(`SELECT count(*) AS total FROM support_tickets t WHERE t.coffee_shop_id=$1${statusClause}`, params),
      this.db.query<Array<Record<string, unknown>>>(
        `SELECT t.id, t.reference_number AS "referenceNumber", t.subject, t.department, t.status,
                t.created_at AS "createdAt", t.last_message_at AS "lastActivityAt", t.last_message_sender_type AS "lastMessageSenderType",
                (t.last_message_sender_type='PLATFORM_USER' AND (t.tenant_last_read_at IS NULL OR t.last_message_at>t.tenant_last_read_at)) AS "hasUnread"
         FROM support_tickets t WHERE t.coffee_shop_id=$1${statusClause}
         ORDER BY t.last_message_at DESC,t.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize],
      ),
    ]);
    return { items, total: Number(countRows[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async detailTenant(coffeeShopId: string, ticketId: string) {
    await this.markRead(ticketId, coffeeShopId, "tenant");
    return this.tenantDetail(this.db.manager, coffeeShopId, ticketId);
  }

  async replyTenant(coffeeShopId: string, ticketId: string, userId: string, input: CreateSupportTicketMessageDto, files: Express.Multer.File[] = []) {
    const messageId = randomUUID();
    if (files.length) await this.assertTicketExists(ticketId, coffeeShopId);
    const attachments = await this.storeAttachments(coffeeShopId, ticketId, messageId, files);
    return this.withStorageCompensation(attachments, ticketId, "tenant reply", () => this.db.transaction(async (manager) => {
      const ticket = await this.lockTicket(manager, ticketId, coffeeShopId);
      if (!ticket) throw new NotFoundException("Support ticket not found");
      if (ticket.status === SupportTicketStatus.Closed && ticket.closeReason !== SupportTicketCloseReason.Inactivity) {
        throw new ConflictException("This support ticket is closed");
      }
      const [message] = await manager.query<Array<{ createdAt: Date }>>(
        `INSERT INTO support_ticket_messages (id,coffee_shop_id,ticket_id,sender_user_id,sender_type,body)
         VALUES ($1,$2,$3,$4,'TENANT_USER',$5) RETURNING created_at AS "createdAt"`,
        [messageId, coffeeShopId, ticketId, userId, input.message],
      );
      await this.persistAttachments(manager, coffeeShopId, messageId, attachments);
      await manager.query(
        `UPDATE support_tickets SET status='WAITING_FOR_PLATFORM',last_message_at=$2,last_message_sender_type='TENANT_USER',tenant_last_read_at=$2,updated_at=$2 WHERE id=$1`,
        [ticketId, message!.createdAt],
      );
      await this.notifications.tenantReplied(manager, ticket, messageId);
      return this.tenantDetail(manager, coffeeShopId, ticketId);
    }));
  }

  async listPlatform(query: PlatformSupportTicketListQueryDto) {
    const values: unknown[] = [];
    const filters: string[] = [];
    const filter = (sql: string, value: unknown) => { values.push(value); filters.push(sql.replace("?", `$${values.length}`)); };
    if (query.status) filter("t.status=?", query.status);
    if (query.department) filter("t.department=?", query.department);
    if (query.tenantId) filter("t.coffee_shop_id=?", query.tenantId);
    if (query.referenceNumber) filter("t.reference_number=?", query.referenceNumber.toUpperCase());
    if (query.search) {
      const pattern = "%" + query.search.replace(/[!%_]/g, "!$&") + "%";
      values.push(pattern);
      const placeholder = "$" + values.length;
      // ponytail: ILIKE contains scans the bounded queue; add pg_trgm if support volume makes it slow.
      filters.push("(t.reference_number::text ILIKE " + placeholder + " ESCAPE '!' OR t.subject ILIKE " + placeholder + " ESCAPE '!' OR cs.name ILIKE " + placeholder + " ESCAPE '!')");
    }
    if (query.tenantSearch) {
      const pattern = "%" + query.tenantSearch.replace(/[!%_]/g, "!$&") + "%";
      values.push(pattern);
      const placeholder = "$" + values.length;
      filters.push("(cs.name ILIKE " + placeholder + " ESCAPE '!' OR cs.slug ILIKE " + placeholder + " ESCAPE '!')");
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const [countRows, items] = await Promise.all([
      this.db.query<Array<{ total: string }>>(`SELECT count(*) AS total FROM support_tickets t JOIN coffee_shops cs ON cs.id=t.coffee_shop_id ${where}`, values),
      this.db.query<Array<Record<string, unknown>>>(
        `SELECT t.id, t.reference_number AS "referenceNumber", t.coffee_shop_id AS "tenantId",
                cs.name AS "tenantName", cs.slug AS "tenantSlug", cs.status AS "tenantStatus",
                t.subject, t.department, t.status, t.created_at AS "createdAt", t.last_message_at AS "lastActivityAt",
                t.last_message_sender_type AS "lastMessageSenderType",
                (t.last_message_sender_type='TENANT_USER' AND (t.platform_last_read_at IS NULL OR t.last_message_at>t.platform_last_read_at)) AS "hasUnread"
         FROM support_tickets t JOIN coffee_shops cs ON cs.id=t.coffee_shop_id ${where}
         ORDER BY t.last_message_at DESC,t.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      ),
    ]);
    return { items, total: Number(countRows[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async detailPlatform(ticketId: string) {
    await this.markRead(ticketId, undefined, "platform");
    return this.platformDetail(this.db.manager, ticketId);
  }

  async replyPlatform(ticketId: string, userId: string, input: CreateSupportTicketMessageDto, files: Express.Multer.File[] = []) {
    const messageId = randomUUID();
    const ticket = files.length ? await this.assertTicketExists(ticketId) : undefined;
    const coffeeShopId = ticket?.coffeeShopId;
    const attachments = coffeeShopId ? await this.storeAttachments(coffeeShopId, ticketId, messageId, files) : [];
    return this.withStorageCompensation(attachments, ticketId, "Platform reply", () => this.db.transaction(async (manager) => {
      const ticket = await this.lockTicket(manager, ticketId);
      if (!ticket) throw new NotFoundException("Support ticket not found");
      if (ticket.status === SupportTicketStatus.Closed) throw new ConflictException("Reopen this support ticket before replying");
      const [message] = await manager.query<Array<{ createdAt: Date }>>(
        `INSERT INTO support_ticket_messages (id,coffee_shop_id,ticket_id,sender_user_id,sender_type,body)
         VALUES ($1,$2,$3,$4,'PLATFORM_USER',$5) RETURNING created_at AS "createdAt"`,
        [messageId, ticket.coffeeShopId, ticketId, userId, input.message],
      );
      await this.persistAttachments(manager, ticket.coffeeShopId, messageId, attachments);
      await manager.query(
        `UPDATE support_tickets SET status='WAITING_FOR_TENANT',last_message_at=$2,last_message_sender_type='PLATFORM_USER',
           last_platform_reply_at=$2,platform_last_read_at=$2,updated_at=$2 WHERE id=$1`,
        [ticketId, message!.createdAt],
      );
      await this.notifications.platformReplied(manager, ticket, messageId);
      return this.platformDetail(manager, ticketId);
    }));
  }

  async autoCloseInactiveTickets(now = new Date()) {
    const cutoff = new Date(now.getTime() - SUPPORT_TICKET_INACTIVITY_MS);
    const candidates = await this.db.query<Array<{ id: string }>>(
      `SELECT id FROM support_tickets
       WHERE status='WAITING_FOR_TENANT' AND last_platform_reply_at <= $1 AND last_message_sender_type='PLATFORM_USER'
       ORDER BY last_platform_reply_at,id LIMIT $2`,
      [cutoff, SUPPORT_TICKET_AUTO_CLOSE_BATCH_SIZE],
    );
    let closed = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const didClose = await this.db.transaction(async (manager) => {
          const ticket = await this.lockTicket(manager, candidate.id);
          if (!ticket || ticket.status !== SupportTicketStatus.WaitingForTenant ||
              ticket.lastMessageSenderType !== SupportTicketSenderType.PlatformUser ||
              !ticket.lastPlatformReplyAt || ticket.lastPlatformReplyAt > cutoff) return false;
          const updated = await manager.query<Array<{ id: string }>>(
            `UPDATE support_tickets
             SET status='CLOSED',close_reason='INACTIVITY',closed_at=clock_timestamp(),closed_by_user_id=NULL,updated_at=clock_timestamp()
             WHERE id=$1 AND status='WAITING_FOR_TENANT' AND last_platform_reply_at <= $2
               AND last_message_sender_type='PLATFORM_USER' RETURNING id`,
            [candidate.id, cutoff],
          );
          return updated.length > 0;
        });
        if (didClose) closed += 1;
        else skipped += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`Support ticket inactivity close failed ticket=${candidate.id}`, error instanceof Error ? error.stack : undefined);
      }
    }
    return { candidates: candidates.length, closed, skipped, failed };
  }

  async cleanupOrphanTicketAttachments(now = new Date()) {
    const result = { tenantsChecked: 0, scanned: 0, stale: 0, deleted: 0, failed: 0 };
    const cutoff = new Date(now.getTime() - SUPPORT_TICKET_ORPHAN_GRACE_MS);
    for (let checked = 0; checked < SUPPORT_TICKET_ORPHAN_TENANTS_PER_SWEEP; checked += 1) {
      let { afterCoffeeShopId, coffeeShopId, continuationToken } = this.orphanSweepCursor;
      if (!coffeeShopId) {
        const shops = await this.db.query<Array<{ id: string }>>(
          `SELECT id FROM coffee_shops WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT 1`, [afterCoffeeShopId ?? null]);
        if (!shops.length && afterCoffeeShopId) {
          this.orphanSweepCursor = {};
          return result;
        }
        if (!shops.length) return result;
        coffeeShopId = shops[0]!.id;
        continuationToken = undefined;
      }

      const page = await this.storage.listSupportTicketObjects(coffeeShopId, continuationToken);
      result.tenantsChecked += 1;
      result.scanned += page.objects.length;
      const prefix = `tenants/${coffeeShopId}/support-tickets/`;
      const stale = page.objects.filter((object) => object.key.startsWith(prefix) && object.lastModified.getTime() <= cutoff.getTime()).map((object) => object.key);
      result.stale += stale.length;
      if (stale.length) {
        const tracked = await this.db.query<Array<{ storageKey: string }>>(
          `SELECT storage_key AS "storageKey" FROM support_ticket_attachments WHERE coffee_shop_id=$2 AND storage_key=ANY($1::text[])`, [stale, coffeeShopId]);
        const trackedKeys = new Set(tracked.map((row) => row.storageKey));
        const orphans = stale.filter((key) => !trackedKeys.has(key));
        if (orphans.length) {
          result.failed = await this.storage.removeSupportTicketObjects(coffeeShopId, orphans);
          result.deleted = orphans.length - result.failed;
          if (result.failed) this.logger.warn(`Ticket orphan attachment cleanup failed tenant=${coffeeShopId} count=${result.failed}`);
        }
      }

      this.orphanSweepCursor = page.continuationToken
        ? { coffeeShopId, continuationToken: page.continuationToken }
        : { afterCoffeeShopId: coffeeShopId };
      if (page.objects.length || page.continuationToken) return result;
    }
    return result;
  }

  async streamTenantAttachment(coffeeShopId: string, ticketId: string, attachmentId: string) {
    return this.streamAttachment(ticketId, attachmentId, coffeeShopId);
  }

  async streamPlatformAttachment(ticketId: string, attachmentId: string) {
    return this.streamAttachment(ticketId, attachmentId);
  }

  private async markRead(ticketId: string, coffeeShopId: string | undefined, surface: "tenant" | "platform") {
    const column = surface === "tenant" ? "tenant_last_read_at" : "platform_last_read_at";
    const tenantClause = coffeeShopId ? " AND coffee_shop_id=$2" : "";
    const values = coffeeShopId ? [ticketId, coffeeShopId] : [ticketId];
    await this.db.query(
      `UPDATE support_tickets SET ${column}=CASE WHEN ${column} IS NULL OR ${column}<last_message_at THEN last_message_at ELSE ${column} END WHERE id=$1${tenantClause}`,
      values,
    );
  }

  async manage(ticketId: string, userId: string, input: UpdateSupportTicketDto) {
    return this.db.transaction(async (manager) => {
      const ticket = await this.lockTicket(manager, ticketId);
      if (!ticket) throw new NotFoundException("Support ticket not found");
      if (input.action === "CHANGE_DEPARTMENT") {
        const department = input.department!;
        if (ticket.department === department) throw new ConflictException("Support ticket is already in this department");
        await manager.query("UPDATE support_tickets SET department=$2,updated_at=clock_timestamp() WHERE id=$1", [ticketId, department]);
        await this.audit.record({ actorUserId: userId, action: "support.ticket.department_changed", targetType: "support_ticket", targetId: ticketId,
          summary: { fromDepartment: ticket.department, toDepartment: department } }, manager);
      } else if (input.action === "CLOSE") {
        if (ticket.status === SupportTicketStatus.Closed) throw new ConflictException("Support ticket is already closed");
        await manager.query(
          `UPDATE support_tickets SET status='CLOSED',close_reason='MANUAL',closed_at=clock_timestamp(),closed_by_user_id=$2,updated_at=clock_timestamp() WHERE id=$1`,
          [ticketId, userId],
        );
        await this.audit.record({ actorUserId: userId, action: "support.ticket.closed", targetType: "support_ticket", targetId: ticketId,
          summary: { fromStatus: ticket.status, toStatus: SupportTicketStatus.Closed, closeReason: SupportTicketCloseReason.Manual } }, manager);
      } else {
        if (ticket.status !== SupportTicketStatus.Closed) throw new ConflictException("Support ticket is not closed");
        await manager.query(`UPDATE support_tickets SET status='WAITING_FOR_PLATFORM',updated_at=clock_timestamp() WHERE id=$1`, [ticketId]);
        await this.audit.record({ actorUserId: userId, action: "support.ticket.reopened", targetType: "support_ticket", targetId: ticketId,
          summary: { fromStatus: SupportTicketStatus.Closed, toStatus: SupportTicketStatus.WaitingForPlatform, closeReason: ticket.closeReason } }, manager);
      }
      return this.platformDetail(manager, ticketId);
    });
  }

  private async lockTicket(manager: EntityManager, ticketId: string, coffeeShopId?: string): Promise<TicketRow | undefined> {
    const values: unknown[] = [ticketId];
    const tenantClause = coffeeShopId ? ` AND t.coffee_shop_id=$${values.push(coffeeShopId)}` : "";
    const rows = await manager.query<TicketRow[]>(`SELECT ${ticketColumns} FROM support_tickets t WHERE t.id=$1${tenantClause} FOR UPDATE`, values);
    return rows[0];
  }

  private async tenantDetail(manager: EntityManager, coffeeShopId: string, ticketId: string) {
    const rows = await manager.query<TicketRow[]>(`SELECT ${ticketColumns} FROM support_tickets t WHERE t.id=$1 AND t.coffee_shop_id=$2`, [ticketId, coffeeShopId]);
    const ticket = rows[0];
    if (!ticket) throw new NotFoundException("Support ticket not found");
    const messages = await this.messages(manager, ticketId, coffeeShopId, "tenant");
    return { ...this.project(ticket, "tenant"), messages };
  }

  private async platformDetail(manager: EntityManager, ticketId: string) {
    const rows = await manager.query<Array<TicketRow & { tenantName: string; tenantSlug: string; tenantStatus: string }>>(
      `SELECT ${ticketColumns}, cs.name AS "tenantName",cs.slug AS "tenantSlug",cs.status AS "tenantStatus"
       FROM support_tickets t JOIN coffee_shops cs ON cs.id=t.coffee_shop_id WHERE t.id=$1`, [ticketId]);
    const ticket = rows[0];
    if (!ticket) throw new NotFoundException("Support ticket not found");
    const messages = await this.messages(manager, ticketId, ticket.coffeeShopId, "platform");
    return { ...this.project(ticket, "platform"), tenant: { id: ticket.coffeeShopId, name: ticket.tenantName, slug: ticket.tenantSlug, status: ticket.tenantStatus }, messages };
  }

  private async messages(manager: EntityManager, ticketId: string, coffeeShopId: string, surface: "tenant" | "platform") {
    const messages = await manager.query<TicketMessageRow[]>(
      `SELECT id, sender_type AS "senderType", body, created_at AS "createdAt"
       FROM support_ticket_messages WHERE coffee_shop_id=$1 AND ticket_id=$2 ORDER BY created_at,id`, [coffeeShopId, ticketId]);
    if (!messages.length) return [];
    const attachments = await manager.query<Array<{ id: string; ticketMessageId: string; originalFilename: string; detectedMimeType: string; sizeBytes: number }>>(
      `SELECT id,ticket_message_id AS "ticketMessageId",original_filename AS "originalFilename",
              detected_mime_type AS "detectedMimeType",size_bytes AS "sizeBytes"
       FROM support_ticket_attachments WHERE coffee_shop_id=$1 AND ticket_message_id=ANY($2::uuid[])
       ORDER BY created_at,id`, [coffeeShopId, messages.map((message) => message.id)]);
    const byMessage = new Map<string, typeof attachments>();
    for (const attachment of attachments) {
      const rows = byMessage.get(attachment.ticketMessageId) ?? [];
      rows.push(attachment);
      byMessage.set(attachment.ticketMessageId, rows);
    }
    const ticketPath = surface === "tenant" ? "/tenant/support/tickets" : "/platform/support/tickets";
    return messages.map((message) => ({
      ...message,
      attachments: (byMessage.get(message.id) ?? []).map(({ id, originalFilename, detectedMimeType, sizeBytes }) => ({
        id, originalFilename, detectedMimeType, sizeBytes: Number(sizeBytes),
        contentUrl: `${ticketPath}/${ticketId}/attachments/${id}/content`,
      })),
    }));
  }

  private async assertTicketExists(ticketId: string, coffeeShopId?: string) {
    const tenantClause = coffeeShopId ? " AND coffee_shop_id=$2" : "";
    const values = coffeeShopId ? [ticketId, coffeeShopId] : [ticketId];
    const rows = await this.db.query<Array<{ coffeeShopId: string }>>(
      `SELECT coffee_shop_id AS "coffeeShopId" FROM support_tickets WHERE id=$1${tenantClause}`, values);
    if (!rows[0]) throw new NotFoundException("Support ticket not found");
    return rows[0];
  }

  private async storeAttachments(coffeeShopId: string, ticketId: string, messageId: string, files: Express.Multer.File[]): Promise<StoredTicketAttachment[]> {
    const inspected = await inspectSupportTicketAttachments(files);
    if (!files.length) return [];
    const stored = inspected.map((attachment) => ({ ...attachment, storageKey: `tenants/${coffeeShopId}/support-tickets/${ticketId}/${messageId}/${randomUUID()}` }));
    const results = await Promise.allSettled(stored.map((attachment, index) =>
      this.storage.putObject(attachment.storageKey, files[index]!.buffer, attachment.detectedMimeType)));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      await this.cleanupAttachments(stored, ticketId, "upload");
      this.logger.warn(`Ticket attachment upload failed for ${ticketId} error=${storageFailureCode(failure.reason)}`);
      throw new ServiceUnavailableException("Ticket attachment storage is unavailable");
    }
    return stored;
  }

  private async persistAttachments(manager: EntityManager, coffeeShopId: string, messageId: string, attachments: StoredTicketAttachment[]) {
    for (const attachment of attachments) {
      await manager.query(
        `INSERT INTO support_ticket_attachments (coffee_shop_id,ticket_message_id,storage_key,original_filename,detected_mime_type,size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [coffeeShopId, messageId, attachment.storageKey, attachment.originalFilename, attachment.detectedMimeType, attachment.sizeBytes],
      );
    }
  }

  private async withStorageCompensation<T>(attachments: StoredTicketAttachment[], ticketId: string, operation: string, action: () => Promise<T>) {
    try { return await action(); }
    catch (error) { await this.cleanupAttachments(attachments, ticketId, operation); throw error; }
  }

  private async cleanupAttachments(attachments: StoredTicketAttachment[], ticketId: string, operation: string) {
    const results = await Promise.allSettled(attachments.map((attachment) => this.storage.removeObject(attachment.storageKey)));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") this.logger.warn(`Ticket attachment cleanup failed after ${operation} for ${ticketId} error=${storageFailureCode(failure.reason)}`);
  }

  private async streamAttachment(ticketId: string, attachmentId: string, coffeeShopId?: string) {
    const tenantClause = coffeeShopId ? " AND t.coffee_shop_id=$3" : "";
    const values = coffeeShopId ? [attachmentId, ticketId, coffeeShopId] : [attachmentId, ticketId];
    const rows = await this.db.query<Array<{ storageKey: string; originalFilename: string; detectedMimeType: SupportTicketAttachmentMimeType; sizeBytes: number }>>(
      `SELECT a.storage_key AS "storageKey",a.original_filename AS "originalFilename",
              a.detected_mime_type AS "detectedMimeType",a.size_bytes AS "sizeBytes"
       FROM support_ticket_attachments a
       JOIN support_ticket_messages m ON m.coffee_shop_id=a.coffee_shop_id AND m.id=a.ticket_message_id
       JOIN support_tickets t ON t.coffee_shop_id=m.coffee_shop_id AND t.id=m.ticket_id
       WHERE a.id=$1 AND t.id=$2${tenantClause}`, values);
    const attachment = rows[0];
    if (!attachment) throw new NotFoundException("Ticket attachment not found");
    try {
      const object = await this.storage.getObject(attachment.storageKey);
      return { ...object, originalFilename: attachment.originalFilename, contentType: attachment.detectedMimeType, contentLength: Number(attachment.sizeBytes) };
    } catch (error) {
      this.logger.warn(`Ticket attachment download failed for ${ticketId} error=${storageFailureCode(error)}`);
      throw new ServiceUnavailableException("Ticket attachment is unavailable");
    }
  }

  private project(ticket: TicketRow, surface: "tenant" | "platform") {
    const { id, referenceNumber, subject, department, status, closeReason, closedAt, lastMessageAt, lastMessageSenderType, lastPlatformReplyAt, createdAt, updatedAt } = ticket;
    const readAt = surface === "tenant" ? ticket.tenantLastReadAt : ticket.platformLastReadAt;
    const opposingSender = surface === "tenant" ? SupportTicketSenderType.PlatformUser : SupportTicketSenderType.TenantUser;
    const hasUnread = lastMessageSenderType === opposingSender && (!readAt || lastMessageAt > readAt);
    return { id, referenceNumber, subject, department, status, closeReason, closedAt, lastActivityAt: lastMessageAt, lastMessageSenderType, lastPlatformReplyAt, hasUnread, createdAt, updatedAt };
  }
}
