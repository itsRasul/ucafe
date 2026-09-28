import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { normalizeIranianMobile, maskPhone } from "../auth/iran-phone.util";
import { displayOrderNumber } from "../notifications/notification-type";
import { ClientDirectoryQueryDto } from "./dto/client-directory-query.dto";
import { ClientTimelineQueryDto } from "./dto/client-timeline-query.dto";
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
