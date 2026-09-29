import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { PlatformAuditService } from "../audit/platform-audit.service";
import { CreateSupportTicketDto, CreateSupportTicketMessageDto, PlatformSupportTicketListQueryDto, TenantSupportTicketListQueryDto } from "./dto/support-ticket.dto";
import { SupportTicketCloseReason, SupportTicketSenderType, SupportTicketStatus } from "./entities";

type TicketRow = {
  id: string; referenceNumber: string; coffeeShopId: string; createdByUserId: string; subject: string;
  department: string; status: SupportTicketStatus; closeReason: SupportTicketCloseReason | null;
  closedAt: Date | null; closedByUserId: string | null; lastMessageAt: Date; lastMessageSenderType: SupportTicketSenderType;
  lastPlatformReplyAt: Date | null; createdAt: Date; updatedAt: Date;
};

const ticketColumns = `t.id, t.reference_number AS "referenceNumber", t.coffee_shop_id AS "coffeeShopId",
  t.created_by_user_id AS "createdByUserId", t.subject, t.department, t.status, t.close_reason AS "closeReason",
  t.closed_at AS "closedAt", t.closed_by_user_id AS "closedByUserId", t.last_message_at AS "lastMessageAt",
  t.last_message_sender_type AS "lastMessageSenderType", t.last_platform_reply_at AS "lastPlatformReplyAt",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt"`;

@Injectable()
export class SupportTicketsService {
  constructor(private readonly db: DataSource, private readonly audit: PlatformAuditService) {}

  async create(coffeeShopId: string, userId: string, input: CreateSupportTicketDto) {
    return this.db.transaction(async (manager) => {
      const [ticket] = await manager.query<Array<{ id: string }>>(
        `INSERT INTO support_tickets (coffee_shop_id, created_by_user_id, subject, department)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [coffeeShopId, userId, input.subject, input.department],
      );
      const [message] = await manager.query<Array<{ createdAt: Date }>>(
        `INSERT INTO support_ticket_messages (coffee_shop_id, ticket_id, sender_user_id, sender_type, body)
         VALUES ($1,$2,$3,'TENANT_USER',$4) RETURNING created_at AS "createdAt"`,
        [coffeeShopId, ticket!.id, userId, input.message],
      );
      await manager.query(
        `UPDATE support_tickets SET last_message_at=$2, last_message_sender_type='TENANT_USER', updated_at=$2 WHERE id=$1`,
        [ticket!.id, message!.createdAt],
      );
      return this.tenantDetail(manager, coffeeShopId, ticket!.id);
    });
  }

  async listTenant(coffeeShopId: string, query: TenantSupportTicketListQueryDto) {
    const params: unknown[] = [coffeeShopId];
    const statusClause = query.status ? ` AND t.status=$${params.push(query.status)}` : "";
    const [countRows, items] = await Promise.all([
      this.db.query<Array<{ total: string }>>(`SELECT count(*) AS total FROM support_tickets t WHERE t.coffee_shop_id=$1${statusClause}`, params),
      this.db.query<Array<Record<string, unknown>>>(
        `SELECT t.id, t.reference_number AS "referenceNumber", t.subject, t.department, t.status,
                t.created_at AS "createdAt", t.last_message_at AS "lastActivityAt", t.last_message_sender_type AS "lastMessageSenderType"
         FROM support_tickets t WHERE t.coffee_shop_id=$1${statusClause}
         ORDER BY t.last_message_at DESC,t.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize],
      ),
    ]);
    return { items, total: Number(countRows[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async detailTenant(coffeeShopId: string, ticketId: string) {
    return this.tenantDetail(this.db.manager, coffeeShopId, ticketId);
  }

  async replyTenant(coffeeShopId: string, ticketId: string, userId: string, input: CreateSupportTicketMessageDto) {
    return this.db.transaction(async (manager) => {
      const ticket = await this.lockTicket(manager, ticketId, coffeeShopId);
      if (!ticket) throw new NotFoundException("Support ticket not found");
      if (ticket.status === SupportTicketStatus.Closed && ticket.closeReason !== SupportTicketCloseReason.Inactivity) {
        throw new ConflictException("This support ticket is closed");
      }
      const [message] = await manager.query<Array<{ createdAt: Date }>>(
        `INSERT INTO support_ticket_messages (coffee_shop_id,ticket_id,sender_user_id,sender_type,body)
         VALUES ($1,$2,$3,'TENANT_USER',$4) RETURNING created_at AS "createdAt"`,
        [coffeeShopId, ticketId, userId, input.message],
      );
      await manager.query(
        `UPDATE support_tickets SET status='WAITING_FOR_PLATFORM',last_message_at=$2,last_message_sender_type='TENANT_USER',updated_at=$2 WHERE id=$1`,
        [ticketId, message!.createdAt],
      );
      return this.tenantDetail(manager, coffeeShopId, ticketId);
    });
  }

  async listPlatform(query: PlatformSupportTicketListQueryDto) {
    const values: unknown[] = [];
    const filters: string[] = [];
    const filter = (sql: string, value: unknown) => { values.push(value); filters.push(sql.replace("?", `$${values.length}`)); };
    if (query.status) filter("t.status=?", query.status);
    if (query.department) filter("t.department=?", query.department);
    if (query.tenantId) filter("t.coffee_shop_id=?", query.tenantId);
    if (query.referenceNumber) filter("t.reference_number=?", query.referenceNumber.toUpperCase());
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const [countRows, items] = await Promise.all([
      this.db.query<Array<{ total: string }>>(`SELECT count(*) AS total FROM support_tickets t ${where}`, values),
      this.db.query<Array<Record<string, unknown>>>(
        `SELECT t.id, t.reference_number AS "referenceNumber", t.coffee_shop_id AS "tenantId",
                cs.name AS "tenantName", cs.slug AS "tenantSlug", cs.status AS "tenantStatus",
                t.subject, t.department, t.status, t.created_at AS "createdAt", t.last_message_at AS "lastActivityAt",
                t.last_message_sender_type AS "lastMessageSenderType"
         FROM support_tickets t JOIN coffee_shops cs ON cs.id=t.coffee_shop_id ${where}
         ORDER BY t.last_message_at DESC,t.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      ),
    ]);
    return { items, total: Number(countRows[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async detailPlatform(ticketId: string) {
    return this.platformDetail(this.db.manager, ticketId);
  }

  async replyPlatform(ticketId: string, userId: string, input: CreateSupportTicketMessageDto) {
    return this.db.transaction(async (manager) => {
      const ticket = await this.lockTicket(manager, ticketId);
      if (!ticket) throw new NotFoundException("Support ticket not found");
      if (ticket.status === SupportTicketStatus.Closed) throw new ConflictException("Reopen this support ticket before replying");
      const [message] = await manager.query<Array<{ createdAt: Date }>>(
        `INSERT INTO support_ticket_messages (coffee_shop_id,ticket_id,sender_user_id,sender_type,body)
         VALUES ($1,$2,$3,'PLATFORM_USER',$4) RETURNING created_at AS "createdAt"`,
        [ticket.coffeeShopId, ticketId, userId, input.message],
      );
      await manager.query(
        `UPDATE support_tickets SET status='WAITING_FOR_TENANT',last_message_at=$2,last_message_sender_type='PLATFORM_USER',
           last_platform_reply_at=$2,updated_at=$2 WHERE id=$1`,
        [ticketId, message!.createdAt],
      );
      return this.platformDetail(manager, ticketId);
    });
  }

  async manage(ticketId: string, userId: string, action: "CLOSE" | "REOPEN") {
    return this.db.transaction(async (manager) => {
      const ticket = await this.lockTicket(manager, ticketId);
      if (!ticket) throw new NotFoundException("Support ticket not found");
      if (action === "CLOSE") {
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
    const messages = await this.messages(manager, ticketId, coffeeShopId);
    return { ...this.project(ticket), messages };
  }

  private async platformDetail(manager: EntityManager, ticketId: string) {
    const rows = await manager.query<Array<TicketRow & { tenantName: string; tenantSlug: string; tenantStatus: string }>>(
      `SELECT ${ticketColumns}, cs.name AS "tenantName",cs.slug AS "tenantSlug",cs.status AS "tenantStatus"
       FROM support_tickets t JOIN coffee_shops cs ON cs.id=t.coffee_shop_id WHERE t.id=$1`, [ticketId]);
    const ticket = rows[0];
    if (!ticket) throw new NotFoundException("Support ticket not found");
    const messages = await this.messages(manager, ticketId, ticket.coffeeShopId);
    return { ...this.project(ticket), tenant: { id: ticket.coffeeShopId, name: ticket.tenantName, slug: ticket.tenantSlug, status: ticket.tenantStatus }, messages };
  }

  private async messages(manager: EntityManager, ticketId: string, coffeeShopId: string) {
    return manager.query<Array<Record<string, unknown>>>(
      `SELECT id, sender_type AS "senderType", body, created_at AS "createdAt"
       FROM support_ticket_messages WHERE coffee_shop_id=$1 AND ticket_id=$2 ORDER BY created_at,id`, [coffeeShopId, ticketId]);
  }

  private project(ticket: TicketRow) {
    const { id, referenceNumber, subject, department, status, closeReason, closedAt, lastMessageAt, lastMessageSenderType, lastPlatformReplyAt, createdAt, updatedAt } = ticket;
    return { id, referenceNumber, subject, department, status, closeReason, closedAt, lastActivityAt: lastMessageAt, lastMessageSenderType, lastPlatformReplyAt, createdAt, updatedAt };
  }
}
