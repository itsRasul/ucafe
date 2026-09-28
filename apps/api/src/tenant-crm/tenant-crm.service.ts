import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { normalizeIranianMobile, maskPhone } from "../auth/iran-phone.util";
import { displayOrderNumber } from "../notifications/notification-type";
import { ClientDirectoryQueryDto } from "./dto/client-directory-query.dto";
import { ClientTimelineQueryDto } from "./dto/client-timeline-query.dto";
import { CreateTenantCrmCustomFieldDto, CreateTenantCrmNoteDto, CreateTenantCrmReminderDto, CreateTenantCrmTagDto,
  TenantCrmCustomFieldListQueryDto, TenantCrmCustomFieldType, TenantCrmNoteListQueryDto, TenantCrmReminderListQueryDto,
  TenantCrmTagListQueryDto, UpdateTenantCrmCustomFieldDto, UpdateTenantCrmCustomFieldValuesDto, UpdateTenantCrmNoteDto,
  UpdateTenantCrmPreferencesDto, UpdateTenantCrmReminderDto, UpdateTenantCrmTagDto } from "./dto/tenant-crm-phase3.dto";
import { decodeTimelineCursor, encodeTimelineCursor } from "./timeline-cursor.util";

type ClientOverviewRow = { id: string; firstName: string; lastName: string; phone: string; status: string; phoneVerifiedAt: Date | null; createdAt: Date; updatedAt: Date;
  trackedOrderCount: number; deliveredOrderCount: number; canceledOrderCount: number;
  knownSpendToman: string; averageDeliveredOrderValueToman: string | null;
  firstOrderAt: Date | null; lastOrderAt: Date | null;
  totalReservationCount: number; completedReservationCount: number; canceledReservationCount: number;
  rejectedReservationCount: number; noShowReservationCount: number;
  firstReservationAt: Date | null; lastReservationAt: Date | null; lastInteractionAt: Date;
};

const overviewSql = `
  WITH order_summary AS (
    SELECT COUNT(*)::int AS tracked_order_count,
           COUNT(*) FILTER (WHERE status='DELIVERED')::int AS delivered_order_count,
           COUNT(*) FILTER (WHERE status='CANCELED')::int AS canceled_order_count,
           COALESCE(SUM(total_amount_toman) FILTER (WHERE status='DELIVERED'),0)::text AS known_spend_toman,
           ROUND(COALESCE(SUM(total_amount_toman) FILTER (WHERE status='DELIVERED'),0)::numeric
             / NULLIF(COUNT(*) FILTER (WHERE status='DELIVERED'),0))::text AS average_delivered_order_value_toman,
           MIN(created_at) AS first_order_at, MAX(created_at) AS last_order_at,
           MAX(GREATEST(created_at,COALESCE(status_changed_at,created_at))) AS last_order_interaction_at
    FROM orders WHERE coffee_shop_id=$1 AND client_id=$2
  ), reservation_summary AS (
    SELECT COUNT(*)::int AS total_reservation_count,
           COUNT(*) FILTER (WHERE status='COMPLETED')::int AS completed_reservation_count,
           COUNT(*) FILTER (WHERE status='CANCELED')::int AS canceled_reservation_count,
           COUNT(*) FILTER (WHERE status='REJECTED')::int AS rejected_reservation_count,
           COUNT(*) FILTER (WHERE status='NO_SHOW')::int AS no_show_reservation_count,
           MIN(created_at) AS first_reservation_at, MAX(created_at) AS last_reservation_at,
           MAX(GREATEST(created_at,COALESCE(status_changed_at,created_at))) AS last_reservation_interaction_at
    FROM reservations WHERE coffee_shop_id=$1 AND client_id=$2
  )
  SELECT c.id, c.first_name AS "firstName", c.last_name AS "lastName", c.phone, c.status,
         c.phone_verified_at AS "phoneVerifiedAt", c.created_at AS "createdAt", c.updated_at AS "updatedAt",
         o.tracked_order_count AS "trackedOrderCount", o.delivered_order_count AS "deliveredOrderCount",
         o.canceled_order_count AS "canceledOrderCount", o.known_spend_toman AS "knownSpendToman",
         o.average_delivered_order_value_toman AS "averageDeliveredOrderValueToman",
         o.first_order_at AS "firstOrderAt", o.last_order_at AS "lastOrderAt",
         r.total_reservation_count AS "totalReservationCount", r.completed_reservation_count AS "completedReservationCount",
         r.canceled_reservation_count AS "canceledReservationCount", r.rejected_reservation_count AS "rejectedReservationCount",
         r.no_show_reservation_count AS "noShowReservationCount", r.first_reservation_at AS "firstReservationAt",
         r.last_reservation_at AS "lastReservationAt",
         GREATEST(c.created_at, o.last_order_interaction_at, r.last_reservation_interaction_at) AS "lastInteractionAt"
  FROM clients c CROSS JOIN order_summary o CROSS JOIN reservation_summary r
  WHERE c.id=$2 AND c.coffee_shop_id=$1`;

const timelineEventsSql = `
  SELECT event_key AS "eventKey", type, occurred_at AS "occurredAt", "sourceType", "sourceId", metadata
  FROM (
    SELECT 'CLIENT:' || c.id::text || ':CREATED' AS event_key, 'CLIENT_CREATED' AS type,
           c.created_at AS occurred_at, 'CLIENT' AS "sourceType", c.id::text AS "sourceId", '{}'::jsonb AS metadata
    FROM clients c WHERE c.coffee_shop_id=$1 AND c.id=$2
    UNION ALL
    SELECT 'ORDER:' || o.id::text || ':CREATED', 'ORDER_CREATED', o.created_at, 'ORDER', o.id::text,
           jsonb_build_object('totalAmountToman',o.total_amount_toman::text,'deliveryMethod',o.delivery_method::text)
    FROM orders o WHERE o.coffee_shop_id=$1 AND o.client_id=$2
    UNION ALL
    SELECT 'ORDER:' || o.id::text || ':STATUS:' || o.status::text,
           CASE o.status WHEN 'DELIVERED' THEN 'ORDER_COMPLETED' WHEN 'CANCELED' THEN 'ORDER_CANCELED' ELSE 'ORDER_STATUS_CHANGED' END,
           o.status_changed_at, 'ORDER', o.id::text, jsonb_build_object('status',o.status::text)
    FROM orders o WHERE o.coffee_shop_id=$1 AND o.client_id=$2 AND o.status_changed_at IS NOT NULL
    UNION ALL
    SELECT 'RESERVATION:' || r.id::text || ':CREATED', 'RESERVATION_CREATED', r.created_at, 'RESERVATION', r.id::text,
           jsonb_build_object('reservationDate',r.reservation_date::text,'startTime',to_char(r.start_time,'HH24:MI'),'partySize',r.party_size)
    FROM reservations r WHERE r.coffee_shop_id=$1 AND r.client_id=$2
    UNION ALL
    SELECT 'RESERVATION:' || r.id::text || ':STATUS:' || r.status::text,
           CASE r.status WHEN 'CONFIRMED' THEN 'RESERVATION_CONFIRMED' WHEN 'COMPLETED' THEN 'RESERVATION_COMPLETED'
             WHEN 'CANCELED' THEN 'RESERVATION_CANCELED' WHEN 'REJECTED' THEN 'RESERVATION_REJECTED'
             WHEN 'NO_SHOW' THEN 'RESERVATION_NO_SHOW' ELSE 'RESERVATION_STATUS_CHANGED' END,
           r.status_changed_at, 'RESERVATION', r.id::text, jsonb_build_object('status',r.status::text)
    FROM reservations r WHERE r.coffee_shop_id=$1 AND r.client_id=$2 AND r.status_changed_at IS NOT NULL
    UNION ALL
    SELECT 'NOTE:' || n.id::text || ':CREATED', 'NOTE_CREATED', n.created_at, 'NOTE', n.id::text, '{}'::jsonb
    FROM tenant_crm_client_notes n WHERE n.coffee_shop_id=$1 AND n.client_id=$2
    UNION ALL
    SELECT 'REMINDER:' || r.id::text || ':CREATED', 'REMINDER_CREATED', r.created_at, 'REMINDER', r.id::text, '{}'::jsonb
    FROM tenant_crm_reminders r WHERE r.coffee_shop_id=$1 AND r.client_id=$2
    UNION ALL
    SELECT 'REMINDER:' || r.id::text || ':COMPLETED', 'REMINDER_COMPLETED', r.completed_at, 'REMINDER', r.id::text, '{}'::jsonb
    FROM tenant_crm_reminders r WHERE r.coffee_shop_id=$1 AND r.client_id=$2 AND r.completed_at IS NOT NULL
  ) events
  WHERE 1=1 __CURSOR_PREDICATE__
  ORDER BY occurred_at DESC,event_key DESC
  LIMIT __LIMIT_PARAMETER__`;

@Injectable()
export class TenantCrmService {
  constructor(private readonly dataSource: DataSource) {}

  async list(coffeeShopId: string, query: ClientDirectoryQueryDto) {
    const { where, parameters } = this.where(coffeeShopId, query);
    const countRows = await this.dataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*)::int AS total FROM clients WHERE ${where}`,
      parameters,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const sortColumn = query.sortBy === "name" ? "lower(first_name || ' ' || last_name)" : "created_at";
    const limitIndex = parameters.length + 1;
    const offsetIndex = parameters.length + 2;
    const rows = await this.dataSource.query<Array<{ id: string; firstName: string; lastName: string; phone: string; status: string; createdAt: Date }>>(
      `SELECT id, first_name AS "firstName", last_name AS "lastName", phone, status, created_at AS "createdAt"
       FROM clients WHERE ${where} ORDER BY ${sortColumn} ${query.sortOrder.toUpperCase()}, id ASC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      [...parameters, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      items: rows.map((row) => ({ ...row, phone: maskPhone(row.phone) })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(coffeeShopId: string, clientId: string) {
    const [overview] = await this.dataSource.query<ClientOverviewRow[]>(overviewSql, [coffeeShopId, clientId]);
    if (!overview) throw new NotFoundException("Client not found");
    const [orders, reservations] = await Promise.all([
      this.dataSource.query<Array<{ id: string; status: string; totalAmountToman: string; deliveryMethod: string; createdAt: Date; statusChangedAt: Date | null }>>(
        `SELECT id,status,total_amount_toman AS "totalAmountToman",delivery_method AS "deliveryMethod",created_at AS "createdAt",status_changed_at AS "statusChangedAt"
         FROM orders WHERE coffee_shop_id=$1 AND client_id=$2 ORDER BY created_at DESC,id DESC LIMIT 5`, [coffeeShopId,clientId]),
      this.dataSource.query<Array<{ id: string; status: string; reservationDate: string; startTime: string; partySize: number; createdAt: Date; statusChangedAt: Date | null }>>(
        `SELECT id,status,reservation_date::text AS "reservationDate",to_char(start_time,'HH24:MI') AS "startTime",party_size AS "partySize",created_at AS "createdAt",status_changed_at AS "statusChangedAt"
         FROM reservations WHERE coffee_shop_id=$1 AND client_id=$2 ORDER BY created_at DESC,id DESC LIMIT 5`, [coffeeShopId,clientId]),
    ]);
    const { trackedOrderCount, deliveredOrderCount, canceledOrderCount, knownSpendToman, averageDeliveredOrderValueToman,
      firstOrderAt, lastOrderAt, totalReservationCount, completedReservationCount, canceledReservationCount,
      rejectedReservationCount, noShowReservationCount, firstReservationAt, lastReservationAt, lastInteractionAt, ...client } = overview;
    return {
      ...client,
      firstSeenAt: client.createdAt,
      lastInteractionAt,
      summary: {
        orders: { trackedCount: trackedOrderCount, deliveredCount: deliveredOrderCount, canceledCount: canceledOrderCount,
          knownSpendToman, averageDeliveredOrderValueToman, firstOrderAt, lastOrderAt },
        reservations: { totalCount: totalReservationCount, completedCount: completedReservationCount, canceledCount: canceledReservationCount,
          rejectedCount: rejectedReservationCount, noShowCount: noShowReservationCount, firstReservationAt, lastReservationAt },
      },
      recentOrders: orders.map((order) => ({ ...order, displayNumber: displayOrderNumber(order.id) })),
      recentReservations: reservations,
    };
  }

  async timeline(coffeeShopId: string, clientId: string, query: ClientTimelineQueryDto) {
    const cursor = decodeTimelineCursor(query.cursor);
    const [client] = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM clients WHERE id=$1 AND coffee_shop_id=$2`, [clientId,coffeeShopId]);
    if (!client) throw new NotFoundException("Client not found");
    const cursorPredicate = cursor ? "AND (occurred_at,event_key) < ($3::timestamptz,$4::text)" : "";
    const limitParameter = cursor ? 5 : 3;
    const sql = timelineEventsSql.replace("__CURSOR_PREDICATE__", cursorPredicate).replace("__LIMIT_PARAMETER__", `$${limitParameter}`);
    const parameters = cursor ? [coffeeShopId,clientId,cursor.occurredAt,cursor.eventKey,query.pageSize + 1] : [coffeeShopId,clientId,query.pageSize + 1];
    const rows = await this.dataSource.query<Array<{ eventKey: string; type: string; occurredAt: Date; sourceType: string; sourceId: string; metadata: Record<string, string | number> }>>(sql, parameters);
    const hasMore = rows.length > query.pageSize;
    const items = rows.slice(0, query.pageSize);
    const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? encodeTimelineCursor({ occurredAt: new Date(last.occurredAt).toISOString(), eventKey: last.eventKey }) : null };
  }

  async listNotes(coffeeShopId: string, clientId: string, query: TenantCrmNoteListQueryDto) {
    await this.assertClient(this.dataSource, coffeeShopId, clientId);
    const parameters = [coffeeShopId, clientId];
    const [count] = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*)::text AS total FROM tenant_crm_client_notes WHERE coffee_shop_id=$1 AND client_id=$2 AND archived_at IS NULL`, parameters,
    );
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(`${this.noteSelectSql()}
      WHERE n.coffee_shop_id=$1 AND n.client_id=$2 AND n.archived_at IS NULL
      ORDER BY n.created_at DESC,n.id DESC LIMIT $3 OFFSET $4`, [...parameters, query.pageSize, (query.page - 1) * query.pageSize]);
    return { items: rows, total: Number(count?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async createNote(coffeeShopId: string, clientId: string, actorId: string, input: CreateTenantCrmNoteDto) {
    return this.dataSource.transaction(async (manager) => {
      await this.assertClient(manager, coffeeShopId, clientId);
      const [note] = await manager.query<Array<{ id: string }>>(
        `INSERT INTO tenant_crm_client_notes(coffee_shop_id,client_id,body,created_by_user_id,updated_by_user_id)
         VALUES($1,$2,$3,$4,$4) RETURNING id`, [coffeeShopId, clientId, input.body.trim(), actorId],
      );
      return this.noteById(manager, coffeeShopId, clientId, note!.id);
    });
  }

  async updateNote(coffeeShopId: string, clientId: string, noteId: string, actorId: string, input: UpdateTenantCrmNoteDto) {
    return this.dataSource.transaction(async (manager) => {
      const [note] = await manager.query<Array<{ id: string }>>(
        `UPDATE tenant_crm_client_notes SET body=$4,updated_by_user_id=$5,updated_at=now()
         WHERE id=$1 AND coffee_shop_id=$2 AND client_id=$3 AND archived_at IS NULL RETURNING id`,
        [noteId, coffeeShopId, clientId, input.body.trim(), actorId],
      );
      if (!note) throw new NotFoundException("Note not found");
      return this.noteById(manager, coffeeShopId, clientId, noteId);
    });
  }

  async archiveNote(coffeeShopId: string, clientId: string, noteId: string, actorId: string) {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `UPDATE tenant_crm_client_notes SET archived_at=now(),updated_by_user_id=$4,updated_at=now()
       WHERE id=$1 AND coffee_shop_id=$2 AND client_id=$3 AND archived_at IS NULL RETURNING id`,
      [noteId, coffeeShopId, clientId, actorId],
    );
    if (!rows[0]) throw new NotFoundException("Note not found");
    return { archived: true };
  }

  private async assertClient(manager: DataSource | EntityManager, coffeeShopId: string, clientId: string) {
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM clients WHERE coffee_shop_id=$1 AND id=$2`, [coffeeShopId, clientId],
    );
    if (!rows[0]) throw new NotFoundException("Client not found");
  }

  private async noteById(manager: DataSource | EntityManager, coffeeShopId: string, clientId: string, noteId: string) {
    const rows = await manager.query<Array<Record<string, unknown>>>(`${this.noteSelectSql()}
      WHERE n.coffee_shop_id=$1 AND n.client_id=$2 AND n.id=$3`, [coffeeShopId, clientId, noteId]);
    if (!rows[0]) throw new NotFoundException("Note not found");
    return rows[0];
  }

  private noteSelectSql() {
    return `SELECT n.id,n.client_id AS "clientId",n.body,n.created_by_user_id AS "createdByUserId",
      CASE WHEN u.phone IS NOT NULL THEN 'کاربر ·•••' || right(u.phone,4) ELSE 'کاربر' END AS "authorLabel",
      n.updated_by_user_id AS "updatedByUserId",n.archived_at AS "archivedAt",n.created_at AS "createdAt",n.updated_at AS "updatedAt"
      FROM tenant_crm_client_notes n LEFT JOIN users u ON u.id=n.created_by_user_id`;
  }

  async preferences(coffeeShopId: string, clientId: string) {
    await this.assertClient(this.dataSource, coffeeShopId, clientId);
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT client_id AS "clientId",preferred_seating AS "preferredSeating",favorite_drink AS "favoriteDrink",
        dietary_notes AS "dietaryNotes",allergy_notes AS "allergyNotes",birthday_month_day AS "birthdayMonthDay",updated_at AS "updatedAt"
       FROM tenant_crm_client_profiles WHERE coffee_shop_id=$1 AND client_id=$2`, [coffeeShopId, clientId]);
    return rows[0] ?? { clientId, preferredSeating: null, favoriteDrink: null, dietaryNotes: null, allergyNotes: null, birthdayMonthDay: null, updatedAt: null };
  }

  async updatePreferences(coffeeShopId: string, clientId: string, actorId: string, input: UpdateTenantCrmPreferencesDto) {
    const columns = [
      ["preferredSeating", "preferred_seating"], ["favoriteDrink", "favorite_drink"], ["dietaryNotes", "dietary_notes"],
      ["allergyNotes", "allergy_notes"], ["birthdayMonthDay", "birthday_month_day"],
    ] as const;
    const changed = columns.filter(([key]) => input[key] !== undefined);
    if (input.birthdayMonthDay && !validMonthDay(input.birthdayMonthDay)) throw new BadRequestException("birthdayMonthDay must be a valid month and day");
    if (!changed.length) return this.preferences(coffeeShopId, clientId);
    return this.dataSource.transaction(async (manager) => {
      await this.assertClient(manager, coffeeShopId, clientId);
      const values = changed.map(([key]) => cleanOptionalText(input[key] as string | null));
      const insertColumns = changed.map(([, column]) => column);
      const placeholders = values.map((_, index) => `$${index + 3}`).join(",");
      const updates = changed.map(([, column]) => `${column}=EXCLUDED.${column}`).join(",");
      await manager.query(`INSERT INTO tenant_crm_client_profiles(coffee_shop_id,client_id,${insertColumns.join(",")},updated_by_user_id)
        VALUES($1,$2,${placeholders},$${values.length + 3})
        ON CONFLICT(coffee_shop_id,client_id) DO UPDATE SET ${updates},updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()`,
      [coffeeShopId, clientId, ...values, actorId]);
      return this.preferencesWith(manager, coffeeShopId, clientId);
    });
  }

  async listTags(coffeeShopId: string, query: TenantCrmTagListQueryDto = {}) {
    const includeArchived = query.includeArchived === "true";
    return this.dataSource.query<Array<Record<string, unknown>>>(`SELECT t.id,t.name,t.archived_at AS "archivedAt",t.created_at AS "createdAt",
        (SELECT COUNT(*)::int FROM tenant_crm_client_tags ct WHERE ct.coffee_shop_id=t.coffee_shop_id AND ct.tag_id=t.id) AS "clientCount"
      FROM tenant_crm_tags t WHERE t.coffee_shop_id=$1 AND ($2::boolean OR t.archived_at IS NULL) ORDER BY t.archived_at NULLS FIRST,lower(t.name),t.id`,
    [coffeeShopId, includeArchived]);
  }

  async createTag(coffeeShopId: string, actorId: string, input: CreateTenantCrmTagDto) {
    try {
      const rows = await this.dataSource.query<Array<{ id: string }>>(`INSERT INTO tenant_crm_tags(coffee_shop_id,name,created_by_user_id)
        VALUES($1,$2,$3) RETURNING id`, [coffeeShopId, input.name.trim(), actorId]);
      return this.tagById(coffeeShopId, rows[0]!.id);
    } catch (error) { this.throwConflict(error, "A tag with this name already exists"); }
  }

  async updateTag(coffeeShopId: string, tagId: string, input: UpdateTenantCrmTagDto) {
    try {
      const rows = await this.dataSource.query<Array<{ id: string }>>(`UPDATE tenant_crm_tags SET name=$3,updated_at=now()
        WHERE coffee_shop_id=$1 AND id=$2 AND archived_at IS NULL RETURNING id`, [coffeeShopId, tagId, input.name.trim()]);
      if (!rows[0]) throw new NotFoundException("Tag not found");
      return this.tagById(coffeeShopId, tagId);
    } catch (error) { this.throwConflict(error, "A tag with this name already exists"); }
  }

  async archiveTag(coffeeShopId: string, tagId: string) {
    const rows = await this.dataSource.query<Array<{ id: string }>>(`UPDATE tenant_crm_tags SET archived_at=now(),updated_at=now()
      WHERE coffee_shop_id=$1 AND id=$2 AND archived_at IS NULL RETURNING id`, [coffeeShopId, tagId]);
    if (!rows[0]) throw new NotFoundException("Tag not found");
    return { archived: true };
  }

  async clientTags(coffeeShopId: string, clientId: string) {
    await this.assertClient(this.dataSource, coffeeShopId, clientId);
    return this.dataSource.query<Array<Record<string, unknown>>>(`SELECT t.id,t.name,ct.created_at AS "assignedAt",ct.created_by_user_id AS "assignedByUserId"
      FROM tenant_crm_client_tags ct JOIN tenant_crm_tags t ON t.coffee_shop_id=ct.coffee_shop_id AND t.id=ct.tag_id
      WHERE ct.coffee_shop_id=$1 AND ct.client_id=$2 AND t.archived_at IS NULL ORDER BY lower(t.name),t.id`, [coffeeShopId, clientId]);
  }

  async assignTag(coffeeShopId: string, clientId: string, tagId: string, actorId: string) {
    await this.dataSource.transaction(async (manager) => {
      await this.assertClient(manager, coffeeShopId, clientId);
      const tags = await manager.query<Array<{ id: string }>>(`SELECT id FROM tenant_crm_tags WHERE coffee_shop_id=$1 AND id=$2 AND archived_at IS NULL`, [coffeeShopId, tagId]);
      if (!tags[0]) throw new NotFoundException("Tag not found");
      await manager.query(`INSERT INTO tenant_crm_client_tags(coffee_shop_id,client_id,tag_id,created_by_user_id)
        VALUES($1,$2,$3,$4) ON CONFLICT(coffee_shop_id,client_id,tag_id) DO NOTHING`, [coffeeShopId, clientId, tagId, actorId]);
    });
    return this.clientTags(coffeeShopId, clientId);
  }

  async removeTag(coffeeShopId: string, clientId: string, tagId: string) {
    await this.assertClient(this.dataSource, coffeeShopId, clientId);
    const rows = await this.dataSource.query<Array<{ id: string }>>(`DELETE FROM tenant_crm_client_tags
      WHERE coffee_shop_id=$1 AND client_id=$2 AND tag_id=$3 RETURNING id`, [coffeeShopId, clientId, tagId]);
    return { removed: Boolean(rows[0]) };
  }

  private async preferencesWith(manager: DataSource | EntityManager, coffeeShopId: string, clientId: string) {
    const rows = await manager.query<Array<Record<string, unknown>>>(`SELECT client_id AS "clientId",preferred_seating AS "preferredSeating",favorite_drink AS "favoriteDrink",
      dietary_notes AS "dietaryNotes",allergy_notes AS "allergyNotes",birthday_month_day AS "birthdayMonthDay",updated_at AS "updatedAt"
      FROM tenant_crm_client_profiles WHERE coffee_shop_id=$1 AND client_id=$2`, [coffeeShopId, clientId]);
    return rows[0]!;
  }

  private async tagById(coffeeShopId: string, tagId: string) {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(`SELECT t.id,t.name,t.archived_at AS "archivedAt",t.created_at AS "createdAt",
      (SELECT COUNT(*)::int FROM tenant_crm_client_tags ct WHERE ct.coffee_shop_id=t.coffee_shop_id AND ct.tag_id=t.id) AS "clientCount"
      FROM tenant_crm_tags t WHERE t.coffee_shop_id=$1 AND t.id=$2`, [coffeeShopId, tagId]);
    if (!rows[0]) throw new NotFoundException("Tag not found");
    return rows[0];
  }

  private throwConflict(error: unknown, message: string): never {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "23505") throw new ConflictException(message);
    throw error;
  }

  async listCustomFields(coffeeShopId: string, query: TenantCrmCustomFieldListQueryDto = {}) {
    return this.customFieldsWith(this.dataSource, coffeeShopId, query.includeInactive === "true");
  }

  async createCustomField(coffeeShopId: string, actorId: string, input: CreateTenantCrmCustomFieldDto) {
    this.assertFieldOptions(input.dataType, input.options ?? []);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const rows = await manager.query<Array<{ id: string }>>(`INSERT INTO tenant_crm_custom_field_definitions
          (coffee_shop_id,key,label,description,data_type,required,sort_order,created_by_user_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [coffeeShopId, input.key, input.label.trim(), cleanOptionalText(input.description), input.dataType, input.required ?? false, input.sortOrder ?? 0, actorId]);
        await this.replaceFieldOptions(manager, coffeeShopId, rows[0]!.id, input.options ?? []);
        return this.customFieldById(manager, coffeeShopId, rows[0]!.id);
      });
    } catch (error) { this.throwConflict(error, "A custom field with this key already exists"); }
  }

  async updateCustomField(coffeeShopId: string, fieldId: string, input: UpdateTenantCrmCustomFieldDto) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const rows = await manager.query<Array<Record<string, unknown>>>(`SELECT id,data_type AS "dataType" FROM tenant_crm_custom_field_definitions
          WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [coffeeShopId, fieldId]);
        const field = rows[0];
        if (!field) throw new NotFoundException("Custom field not found");
        if (input.options !== undefined) {
          this.assertFieldOptions(field.dataType as TenantCrmCustomFieldType, input.options);
          await this.replaceFieldOptions(manager, coffeeShopId, fieldId, input.options);
        }
        const update = await manager.query<Array<{ id: string }>>(`UPDATE tenant_crm_custom_field_definitions SET
          label=COALESCE($3,label),description=CASE WHEN $4::boolean THEN $5 ELSE description END,
          required=COALESCE($6,required),active=COALESCE($7,active),sort_order=COALESCE($8,sort_order),updated_at=now()
          WHERE coffee_shop_id=$1 AND id=$2 RETURNING id`, [coffeeShopId, fieldId, input.label?.trim() ?? null,
          input.description !== undefined, cleanOptionalText(input.description), input.required ?? null, input.active ?? null, input.sortOrder ?? null]);
        if (!update[0]) throw new NotFoundException("Custom field not found");
        return this.customFieldById(manager, coffeeShopId, fieldId);
      });
    } catch (error) { this.throwConflict(error, "A custom field with this key already exists"); }
  }

  async clientCustomFields(coffeeShopId: string, clientId: string) {
    await this.assertClient(this.dataSource, coffeeShopId, clientId);
    return this.clientCustomFieldsWith(this.dataSource, coffeeShopId, clientId);
  }

  async updateClientCustomFields(coffeeShopId: string, clientId: string, actorId: string, input: UpdateTenantCrmCustomFieldValuesDto) {
    return this.dataSource.transaction(async (manager) => {
      await this.assertClient(manager, coffeeShopId, clientId);
      const fields = await manager.query<Array<Record<string, unknown>>>(`SELECT id,key,data_type AS "dataType",required
        FROM tenant_crm_custom_field_definitions WHERE coffee_shop_id=$1 AND active=TRUE`, [coffeeShopId]);
      const byKey = new Map(fields.map((field) => [String(field.key), field]));
      for (const [key, value] of Object.entries(input.values)) {
        const field = byKey.get(key);
        if (!field) throw new BadRequestException(`Unknown or inactive custom field: ${key}`);
        if (value === null) {
          await manager.query(`DELETE FROM tenant_crm_client_custom_field_values WHERE coffee_shop_id=$1 AND client_id=$2 AND field_definition_id=$3`,
            [coffeeShopId, clientId, field.id]);
          continue;
        }
        const validated = await this.validateFieldValue(manager, coffeeShopId, field, value);
        await manager.query(`INSERT INTO tenant_crm_client_custom_field_values(coffee_shop_id,client_id,field_definition_id,value,updated_by_user_id)
          VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(coffee_shop_id,client_id,field_definition_id)
          DO UPDATE SET value=EXCLUDED.value,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()`,
        [coffeeShopId, clientId, field.id, JSON.stringify(validated), actorId]);
      }
      const missing = await manager.query<Array<{ key: string }>>(`SELECT d.key FROM tenant_crm_custom_field_definitions d
        LEFT JOIN tenant_crm_client_custom_field_values v ON v.coffee_shop_id=d.coffee_shop_id AND v.field_definition_id=d.id AND v.client_id=$2
        WHERE d.coffee_shop_id=$1 AND d.active=TRUE AND d.required=TRUE AND v.id IS NULL LIMIT 1`, [coffeeShopId, clientId]);
      if (missing[0]) throw new BadRequestException(`Required custom field is missing: ${missing[0].key}`);
      return this.clientCustomFieldsWith(manager, coffeeShopId, clientId);
    });
  }

  private async customFieldsWith(manager: DataSource | EntityManager, coffeeShopId: string, includeInactive: boolean) {
    return manager.query<Array<Record<string, unknown>>>(`SELECT d.id,d.key,d.label,d.description,d.data_type AS "dataType",d.required,d.active,
        d.sort_order AS "sortOrder",d.created_at AS "createdAt",d.updated_at AS "updatedAt",
        COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'active',o.active,'sortOrder',o.sort_order)
          ORDER BY o.sort_order,o.id) FILTER (WHERE o.id IS NOT NULL),'[]'::jsonb) AS options
      FROM tenant_crm_custom_field_definitions d LEFT JOIN tenant_crm_custom_field_options o
        ON o.coffee_shop_id=d.coffee_shop_id AND o.field_definition_id=d.id
      WHERE d.coffee_shop_id=$1 AND ($2::boolean OR d.active=TRUE)
      GROUP BY d.id ORDER BY d.sort_order,d.created_at,d.id`, [coffeeShopId, includeInactive]);
  }

  private async customFieldById(manager: DataSource | EntityManager, coffeeShopId: string, fieldId: string) {
    const fields = await manager.query<Array<Record<string, unknown>>>(`SELECT d.id,d.key,d.label,d.description,d.data_type AS "dataType",d.required,d.active,
        d.sort_order AS "sortOrder",d.created_at AS "createdAt",d.updated_at AS "updatedAt",
        COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'active',o.active,'sortOrder',o.sort_order)
          ORDER BY o.sort_order,o.id) FILTER (WHERE o.id IS NOT NULL),'[]'::jsonb) AS options
      FROM tenant_crm_custom_field_definitions d LEFT JOIN tenant_crm_custom_field_options o
        ON o.coffee_shop_id=d.coffee_shop_id AND o.field_definition_id=d.id
      WHERE d.coffee_shop_id=$1 AND d.id=$2 GROUP BY d.id`, [coffeeShopId, fieldId]);
    if (!fields[0]) throw new NotFoundException("Custom field not found");
    return fields[0];
  }

  private async replaceFieldOptions(manager: EntityManager, coffeeShopId: string, fieldId: string, options: Array<{ id?: string; label: string; active?: boolean }>) {
    const current = await manager.query<Array<{ id: string }>>(`SELECT id FROM tenant_crm_custom_field_options WHERE coffee_shop_id=$1 AND field_definition_id=$2`, [coffeeShopId, fieldId]);
    const currentIds = new Set(current.map((option) => option.id));
    const retained: string[] = [];
    for (const [index, option] of options.entries()) {
      if (option.id) {
        if (!currentIds.has(option.id)) throw new BadRequestException("Custom field option does not belong to this field");
        retained.push(option.id);
        await manager.query(`UPDATE tenant_crm_custom_field_options SET label=$4,active=$5,sort_order=$6,updated_at=now()
          WHERE coffee_shop_id=$1 AND field_definition_id=$2 AND id=$3`, [coffeeShopId, fieldId, option.id, option.label.trim(), option.active ?? true, index]);
      } else {
        const rows = await manager.query<Array<{ id: string }>>(`INSERT INTO tenant_crm_custom_field_options
          (coffee_shop_id,field_definition_id,label,active,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [coffeeShopId, fieldId, option.label.trim(), option.active ?? true, index]);
        retained.push(rows[0]!.id);
      }
    }
    await manager.query(`UPDATE tenant_crm_custom_field_options SET active=FALSE,updated_at=now()
      WHERE coffee_shop_id=$1 AND field_definition_id=$2 AND active=TRUE AND NOT (id=ANY($3::uuid[]))`, [coffeeShopId, fieldId, retained]);
  }

  private assertFieldOptions(type: TenantCrmCustomFieldType, options: unknown[]) {
    const isSelect = type === "SINGLE_SELECT" || type === "MULTI_SELECT";
    if (isSelect && options.length < 1) throw new BadRequestException("Select custom fields need at least one option");
    if (!isSelect && options.length) throw new BadRequestException("Only select custom fields support options");
    const ids = options.filter((option) => typeof option === "object" && option && "id" in option && (option as { id?: unknown }).id).map((option) => String((option as { id: unknown }).id));
    if (new Set(ids).size !== ids.length) throw new BadRequestException("Custom field option IDs must be unique");
    if (new Set(options.filter((option) => typeof option === "object" && option && "label" in option).map((option) => String((option as { label: unknown }).label).trim().toLocaleLowerCase())).size !== options.length) {
      throw new BadRequestException("Custom field option labels must be unique");
    }
  }

  private async validateFieldValue(manager: EntityManager, coffeeShopId: string, field: Record<string, unknown>, value: unknown) {
    const type = field.dataType as TenantCrmCustomFieldType;
    const text = (max: number) => {
      if (typeof value !== "string" || !value.trim() || value.length > max) throw new BadRequestException(`${String(field.key)} must be a non-empty string of at most ${max} characters`);
      return value.trim();
    };
    switch (type) {
      case "TEXT": return text(500);
      case "LONG_TEXT": return text(4000);
      case "URL": {
        const raw = text(2048);
        try { const url = new URL(raw); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); return raw; }
        catch { throw new BadRequestException(`${String(field.key)} must be an HTTP or HTTPS URL`); }
      }
      case "NUMBER":
        if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) throw new BadRequestException(`${String(field.key)} must be a finite number within range`);
        return value;
      case "BOOLEAN":
        if (typeof value !== "boolean") throw new BadRequestException(`${String(field.key)} must be true or false`);
        return value;
      case "DATE":
        if (typeof value !== "string" || !validIsoDate(value)) throw new BadRequestException(`${String(field.key)} must be an ISO date (YYYY-MM-DD)`);
        return value;
      case "SINGLE_SELECT": {
        if (typeof value !== "string" || !isUuid(value)) throw new BadRequestException(`${String(field.key)} must be a valid option`);
        const options = await manager.query<Array<{ id: string }>>(`SELECT id FROM tenant_crm_custom_field_options
          WHERE coffee_shop_id=$1 AND field_definition_id=$2 AND id=$3 AND active=TRUE`, [coffeeShopId, field.id, value]);
        if (!options[0]) throw new BadRequestException(`${String(field.key)} must be an active option`);
        return value;
      }
      case "MULTI_SELECT": {
        if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string" || !isUuid(item)) || new Set(value).size !== value.length) {
          throw new BadRequestException(`${String(field.key)} must be a unique list of up to 100 options`);
        }
        if (field.required === true && value.length === 0) throw new BadRequestException(`${String(field.key)} is required`);
        if (value.length) {
          const options = await manager.query<Array<{ id: string }>>(`SELECT id FROM tenant_crm_custom_field_options
            WHERE coffee_shop_id=$1 AND field_definition_id=$2 AND id=ANY($3::uuid[]) AND active=TRUE`, [coffeeShopId, field.id, value]);
          if (options.length !== value.length) throw new BadRequestException(`${String(field.key)} contains an invalid or inactive option`);
        }
        return value;
      }
      default: throw new BadRequestException("Unsupported custom field type");
    }
  }

  private async clientCustomFieldsWith(manager: DataSource | EntityManager, coffeeShopId: string, clientId: string) {
    const fields = await this.customFieldsWith(manager, coffeeShopId, false);
    const values = await manager.query<Array<{ key: string; value: unknown }>>(`SELECT d.key,v.value FROM tenant_crm_client_custom_field_values v
      JOIN tenant_crm_custom_field_definitions d ON d.coffee_shop_id=v.coffee_shop_id AND d.id=v.field_definition_id
      WHERE v.coffee_shop_id=$1 AND v.client_id=$2 AND d.active=TRUE`, [coffeeShopId, clientId]);
    const byKey = new Map(values.map(({ key, value }) => [key, value]));
    return { fields: fields.map((field) => ({ ...field, value: byKey.get(String(field.key)) ?? null })) };
  }

  async listReminders(coffeeShopId: string, timeZone: string, query: TenantCrmReminderListQueryDto) {
    if (query.clientId) await this.assertClient(this.dataSource, coffeeShopId, query.clientId);
    const clauses = ["r.coffee_shop_id=$1"];
    const parameters: unknown[] = [coffeeShopId];
    if (query.clientId) { parameters.push(query.clientId); clauses.push(`r.client_id=$${parameters.length}`); }
    if (query.assignedToUserId) { parameters.push(query.assignedToUserId); clauses.push(`r.assigned_to_user_id=$${parameters.length}`); }
    if (query.view === "OVERDUE") clauses.push("r.status='OPEN' AND r.due_at < now()");
    else if (query.view === "UPCOMING") clauses.push("r.status='OPEN' AND r.due_at >= now()");
    else if (query.view === "TODAY") {
      parameters.push(timeZone);
      const zone = `$${parameters.length}`;
      clauses.push(`r.status='OPEN' AND r.due_at >= date_trunc('day',now() AT TIME ZONE ${zone}) AT TIME ZONE ${zone}
        AND r.due_at < (date_trunc('day',now() AT TIME ZONE ${zone}) + interval '1 day') AT TIME ZONE ${zone}`);
    } else if (query.view === "COMPLETED" || query.view === "CANCELED") {
      parameters.push(query.view);
      clauses.push(`r.status=$${parameters.length}`);
    }
    const where = clauses.join(" AND ");
    const [count] = await this.dataSource.query<Array<{ total: string }>>(`SELECT COUNT(*)::text AS total FROM tenant_crm_reminders r WHERE ${where}`, parameters);
    const pageParameters = [...parameters, query.pageSize, (query.page - 1) * query.pageSize];
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(`${this.reminderSelectSql()}
      WHERE ${where} ORDER BY CASE WHEN r.status='OPEN' THEN 0 ELSE 1 END,
        CASE WHEN r.status='OPEN' THEN r.due_at END ASC NULLS LAST,r.updated_at DESC,r.id DESC
      LIMIT $${pageParameters.length - 1} OFFSET $${pageParameters.length}`, pageParameters);
    return { items: rows, total: Number(count?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async listActiveTenantUsers(coffeeShopId: string) {
    return this.dataSource.query<Array<{ id: string; label: string }>>(`SELECT u.id,
      CASE WHEN u.phone IS NOT NULL THEN 'کاربر ·•••' || right(u.phone,4) ELSE 'کاربر' END AS label
      FROM coffee_shop_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.coffee_shop_id=$1 AND m.status='ACTIVE' AND u.status='ACTIVE' AND u.deleted_at IS NULL
      ORDER BY label,u.id`, [coffeeShopId]);
  }

  async createReminder(coffeeShopId: string, clientId: string, actorId: string, input: CreateTenantCrmReminderDto) {
    return this.dataSource.transaction(async (manager) => {
      await this.assertClient(manager, coffeeShopId, clientId);
      const dueAt = new Date(input.dueAt);
      if (Number.isNaN(dueAt.getTime())) throw new BadRequestException("dueAt must be a valid date and time");
      if (input.assignedToUserId) await this.assertActiveTenantUser(manager, coffeeShopId, input.assignedToUserId);
      const rows = await manager.query<Array<{ id: string }>>(`INSERT INTO tenant_crm_reminders
        (coffee_shop_id,client_id,title,description,due_at,assigned_to_user_id,created_by_user_id,updated_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
      [coffeeShopId, clientId, input.title.trim(), cleanOptionalText(input.description), dueAt, input.assignedToUserId ?? null, actorId]);
      return this.reminderById(manager, coffeeShopId, rows[0]!.id);
    });
  }

  async updateReminder(coffeeShopId: string, reminderId: string, actorId: string, input: UpdateTenantCrmReminderDto) {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<Record<string, unknown>>>(`SELECT id,client_id AS "clientId",title,description,due_at AS "dueAt",
        status,assigned_to_user_id AS "assignedToUserId",completed_at AS "completedAt" FROM tenant_crm_reminders
        WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [coffeeShopId, reminderId]);
      const current = rows[0];
      if (!current) throw new NotFoundException("Reminder not found");
      const assignedToUserId = input.assignedToUserId === undefined ? current.assignedToUserId : input.assignedToUserId;
      if (assignedToUserId) await this.assertActiveTenantUser(manager, coffeeShopId, String(assignedToUserId));
      const status = input.status ?? current.status;
      const completedAt = status === "COMPLETED" ? current.status === "COMPLETED" ? current.completedAt : new Date() : null;
      const dueAt = input.dueAt === undefined ? current.dueAt : new Date(input.dueAt);
      if (Number.isNaN(new Date(dueAt as string | Date).getTime())) throw new BadRequestException("dueAt must be a valid date and time");
      await manager.query(`UPDATE tenant_crm_reminders SET title=$3,description=$4,due_at=$5,status=$6,assigned_to_user_id=$7,
        completed_at=$8,updated_by_user_id=$9,updated_at=now() WHERE coffee_shop_id=$1 AND id=$2`,
      [coffeeShopId, reminderId, input.title?.trim() ?? current.title, input.description === undefined ? current.description : cleanOptionalText(input.description),
        dueAt, status, assignedToUserId, completedAt, actorId]);
      return this.reminderById(manager, coffeeShopId, reminderId);
    });
  }

  private async assertActiveTenantUser(manager: EntityManager, coffeeShopId: string, userId: string) {
    const rows = await manager.query<Array<{ id: string }>>(`SELECT m.user_id AS id FROM coffee_shop_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.coffee_shop_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND u.status='ACTIVE' AND u.deleted_at IS NULL`, [coffeeShopId, userId]);
    if (!rows[0]) throw new BadRequestException("Assigned user must be an active member of this café");
  }

  private reminderSelectSql() {
    return `SELECT r.id,r.client_id AS "clientId",c.first_name AS "clientFirstName",c.last_name AS "clientLastName",
      r.title,r.description,r.due_at AS "dueAt",r.status,r.assigned_to_user_id AS "assignedToUserId",
      CASE WHEN u.phone IS NOT NULL THEN 'کاربر ·•••' || right(u.phone,4) ELSE CASE WHEN u.id IS NULL THEN NULL ELSE 'کاربر' END END AS "assigneeLabel",
      r.created_by_user_id AS "createdByUserId",r.completed_at AS "completedAt",r.created_at AS "createdAt",r.updated_at AS "updatedAt",
      (r.status='OPEN' AND r.due_at < now()) AS "overdue"
      FROM tenant_crm_reminders r JOIN clients c ON c.coffee_shop_id=r.coffee_shop_id AND c.id=r.client_id
      LEFT JOIN users u ON u.id=r.assigned_to_user_id`;
  }

  private async reminderById(manager: DataSource | EntityManager, coffeeShopId: string, reminderId: string) {
    const rows = await manager.query<Array<Record<string, unknown>>>(`${this.reminderSelectSql()} WHERE r.coffee_shop_id=$1 AND r.id=$2`, [coffeeShopId, reminderId]);
    if (!rows[0]) throw new NotFoundException("Reminder not found");
    return rows[0];
  }

  private where(coffeeShopId: string, query: ClientDirectoryQueryDto) {
    const clauses = ["coffee_shop_id=$1"];
    const parameters: unknown[] = [coffeeShopId];
    if (query.status) {
      parameters.push(query.status);
      clauses.push(`status=$${parameters.length}`);
    }
    const q = query.q?.trim();
    if (q) {
      let phone: string | undefined;
      try { phone = normalizeIranianMobile(q); } catch { /* A non-phone query remains a name search. */ }
      if (phone) {
        parameters.push(phone);
        clauses.push(`phone=$${parameters.length}`);
      } else {
        parameters.push(`%${q}%`);
        clauses.push(`(first_name ILIKE $${parameters.length} OR last_name ILIKE $${parameters.length} OR (first_name || ' ' || last_name) ILIKE $${parameters.length})`);
      }
    }
    return { where: clauses.join(" AND "), parameters };
  }
}

function cleanOptionalText(value: string | null | undefined): string | null {
  return value == null || !value.trim() ? null : value.trim();
}

function validMonthDay(value: string) {
  if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(value)) return false;
  const [month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(2000, month! - 1, day));
  return date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

function validIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
