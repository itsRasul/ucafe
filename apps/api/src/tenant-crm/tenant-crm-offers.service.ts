import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { maskPhone } from "../auth/iran-phone.util";
import { Promotion as PromotionEntity } from "../promotions/entities";
import { promotionStatus } from "../promotions/promotion-pricing.util";
import { TenantCrmSegmentsService } from "./tenant-crm-segments.service";
import { CreateTenantCrmOfferDto, TenantCrmOfferClientsQueryDto, TenantCrmOfferListQueryDto, UpdateTenantCrmOfferDto } from "./dto/tenant-crm-offers.dto";

type OfferRow = Record<string, any>;

@Injectable()
export class TenantCrmOffersService {
  constructor(private readonly dataSource: DataSource, private readonly segments: TenantCrmSegmentsService) {}

  async list(coffeeShopId: string, query: TenantCrmOfferListQueryDto) {
    const parameters: unknown[] = [coffeeShopId];
    const where = ["o.coffee_shop_id=$1"];
    if (query.status) { parameters.push(query.status); where.push(`o.status=$${parameters.length}`); }
    if (query.q?.trim()) { parameters.push(query.q.trim()); where.push(`strpos(lower(o.name),lower($${parameters.length}::text))>0`); }
    const [count] = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*)::text AS total FROM tenant_crm_offers o WHERE ${where.join(" AND ")}`, parameters);
    const values = [...parameters, query.pageSize, (query.page - 1) * query.pageSize];
    const items = await this.dataSource.query<OfferRow[]>(`${this.selectSql()}
      WHERE ${where.join(" AND ")} ORDER BY o.updated_at DESC,o.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { items, total: Number(count?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async detail(coffeeShopId: string, offerId: string) {
    const [offer] = await this.dataSource.query<OfferRow[]>(`${this.selectSql()}
      WHERE o.coffee_shop_id=$1 AND o.id=$2`, [coffeeShopId, offerId]);
    if (!offer) throw new NotFoundException("Offer not found");
    return offer;
  }

  async preview(coffeeShopId: string, timeZone: string, segmentId: string) {
    const segment = await this.segments.get(coffeeShopId, timeZone, segmentId);
    if (!segment.isActive) throw new BadRequestException("Offer audience Segment must be active");
    return this.segments.segmentPreview(coffeeShopId, timeZone, segmentId);
  }

  async createDraft(coffeeShopId: string, actorId: string, timeZone: string, input: CreateTenantCrmOfferDto) {
    const id = await this.dataSource.transaction(async (manager) => {
      await this.assertPromotion(manager, coffeeShopId, input.promotionId);
      await this.segments.audienceQuery(manager, coffeeShopId, timeZone, input.segmentId);
      const rows = await manager.query<Array<{ id: string }>>(`INSERT INTO tenant_crm_offers
        (coffee_shop_id,name,description,promotion_id,segment_id,created_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [coffeeShopId, input.name.trim(), this.clean(input.description), input.promotionId, input.segmentId, actorId]);
      return rows[0]!.id;
    }).catch((error: unknown) => this.throwConflict(error));
    return this.detail(coffeeShopId, id);
  }

  async updateDraft(coffeeShopId: string, timeZone: string, offerId: string, input: UpdateTenantCrmOfferDto) {
    await this.dataSource.transaction(async (manager) => {
      const [offer] = await manager.query<Array<{ status: string; promotionId: string; segmentId: string }>>(`SELECT status,promotion_id AS "promotionId",segment_id AS "segmentId"
        FROM tenant_crm_offers WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [coffeeShopId, offerId]);
      if (!offer) throw new NotFoundException("Offer not found");
      if (offer.status !== "DRAFT") throw new ConflictException("Only Draft Offers can be edited");
      const promotionId = input.promotionId ?? offer.promotionId;
      const segmentId = input.segmentId ?? offer.segmentId;
      await this.assertPromotion(manager, coffeeShopId, promotionId);
      await this.segments.audienceQuery(manager, coffeeShopId, timeZone, segmentId);
      await manager.query(`UPDATE tenant_crm_offers SET name=COALESCE($3,name),
        description=CASE WHEN $4::boolean THEN $5 ELSE description END,promotion_id=$6,segment_id=$7,updated_at=clock_timestamp()
        WHERE coffee_shop_id=$1 AND id=$2 AND status='DRAFT'`, [coffeeShopId, offerId, input.name?.trim() || null,
        input.description !== undefined, this.clean(input.description), promotionId, segmentId]);
    }).catch((error: unknown) => this.throwConflict(error));
    return this.detail(coffeeShopId, offerId);
  }

  async activate(coffeeShopId: string, timeZone: string, offerId: string) {
    // ponytail: a single set-based transaction keeps the published audience atomic; stage activation only if measured tenant audiences outgrow a safe PostgreSQL transaction.
    await this.dataSource.transaction(async (manager) => {
      const [offer] = await manager.query<Array<{ status: string; promotionId: string; segmentId: string }>>(`SELECT status,promotion_id AS "promotionId",segment_id AS "segmentId"
        FROM tenant_crm_offers WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [coffeeShopId, offerId]);
      if (!offer) throw new NotFoundException("Offer not found");
      if (offer.status === "ACTIVE") return;
      if (offer.status !== "DRAFT") throw new ConflictException("Ended Offers cannot be reactivated");
      const now = new Date();
      const promotion = await manager.findOne(PromotionEntity, { where: { id: offer.promotionId, coffeeShopId }, relations: { scheduleWindows: true, coupon: true } });
      if (!promotion || promotionStatus(promotion, now, timeZone) !== "RUNNING")
        throw new BadRequestException("The referenced Discount must be active and currently usable");
      const coupon = promotion.coupon;
      if (coupon && (!coupon.isActive || (coupon.startsAt && coupon.startsAt > now) || (coupon.expiresAt && coupon.expiresAt <= now)))
        throw new BadRequestException("The referenced Discount code must be active and currently usable");

      const audience = await this.segments.audienceQuery(manager, coffeeShopId, timeZone, offer.segmentId);
      const offerIndex = audience.parameters.length + 1;
      await manager.query(`WITH candidates AS (${audience.sql}), inserted AS (
        INSERT INTO tenant_crm_offer_audience_members(coffee_shop_id,offer_id,client_id)
        SELECT $1,$${offerIndex},candidates.id FROM candidates ON CONFLICT DO NOTHING RETURNING id
      ) SELECT COUNT(*)::text AS total FROM inserted`, [...audience.parameters, offerId]);
      await manager.query(`UPDATE tenant_crm_offers SET status='ACTIVE',activated_at=clock_timestamp(),
        segment_name_snapshot=$3,segment_criteria_snapshot=$4::jsonb,updated_at=clock_timestamp()
        WHERE coffee_shop_id=$1 AND id=$2 AND status='DRAFT'`,
      [coffeeShopId, offerId, audience.segmentName, JSON.stringify(audience.criteria)]);
    });
    return this.detail(coffeeShopId, offerId);
  }

  async end(coffeeShopId: string, offerId: string) {
    await this.dataSource.transaction(async (manager) => {
      const [offer] = await manager.query<Array<{ status: string }>>(`SELECT status FROM tenant_crm_offers
        WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [coffeeShopId, offerId]);
      if (!offer) throw new NotFoundException("Offer not found");
      if (offer.status === "ENDED") return;
      if (offer.status !== "ACTIVE") throw new ConflictException("Only active Offers can be ended");
      await manager.query(`UPDATE tenant_crm_offers SET status='ENDED',ended_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE coffee_shop_id=$1 AND id=$2 AND status='ACTIVE'`, [coffeeShopId, offerId]);
    });
    return this.detail(coffeeShopId, offerId);
  }

  async audienceMembers(coffeeShopId: string, offerId: string, query: TenantCrmOfferClientsQueryDto) {
    await this.detail(coffeeShopId, offerId);
    const [count] = await this.dataSource.query<Array<{ total: string }>>(`SELECT COUNT(*)::text AS total
      FROM tenant_crm_offer_audience_members WHERE coffee_shop_id=$1 AND offer_id=$2`, [coffeeShopId, offerId]);
    const rows = await this.dataSource.query<OfferRow[]>(`SELECT c.id,c.first_name AS "firstName",c.last_name AS "lastName",c.phone,c.status,
      a.granted_at AS "grantedAt" FROM tenant_crm_offer_audience_members a
      JOIN clients c ON c.coffee_shop_id=a.coffee_shop_id AND c.id=a.client_id
      WHERE a.coffee_shop_id=$1 AND a.offer_id=$2 ORDER BY a.granted_at DESC,a.id DESC
      LIMIT $3 OFFSET $4`, [coffeeShopId, offerId, query.pageSize, (query.page - 1) * query.pageSize]);
    return { items: rows.map((row) => ({ ...row, phone: maskPhone(String(row.phone)) })), total: Number(count?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async clientOffers(coffeeShopId: string, clientId: string, query: TenantCrmOfferClientsQueryDto) {
    const [client] = await this.dataSource.query<Array<{ id: string }>>(`SELECT id FROM clients WHERE coffee_shop_id=$1 AND id=$2`, [coffeeShopId, clientId]);
    if (!client) throw new NotFoundException("Client not found");
    const [count] = await this.dataSource.query<Array<{ total: string }>>(`SELECT COUNT(*)::text AS total
      FROM tenant_crm_offer_audience_members WHERE coffee_shop_id=$1 AND client_id=$2`, [coffeeShopId, clientId]);
    const values = [coffeeShopId, clientId, query.pageSize, (query.page - 1) * query.pageSize];
    const items = await this.dataSource.query<OfferRow[]>(`SELECT o.id,o.name,o.description,o.status,
      o.segment_name_snapshot AS "segmentName",o.activated_at AS "activatedAt",o.ended_at AS "endedAt",a.granted_at AS "grantedAt",
      p.name AS "promotionName",p.is_active AS "promotionActive",p.start_at AS "promotionStartsAt",p.end_at AS "promotionEndsAt",
      (SELECT COUNT(*)::int FROM promotion_redemptions r WHERE r.coffee_shop_id=o.coffee_shop_id AND r.promotion_id=o.promotion_id
        AND r.customer_id=a.client_id AND r.status='APPLIED' AND r.created_at>=o.activated_at
        AND (o.ended_at IS NULL OR r.created_at<o.ended_at)) AS "redemptionCount",
      (SELECT COUNT(DISTINCT ord.id)::int FROM orders ord WHERE ord.coffee_shop_id=o.coffee_shop_id AND ord.client_id=a.client_id
        AND ord.created_at>=o.activated_at AND (o.ended_at IS NULL OR ord.created_at<o.ended_at)
        AND ((ord.order_promotion_id_snapshot=o.promotion_id AND ord.order_discount_toman>0) OR EXISTS (
          SELECT 1 FROM order_items oi WHERE oi.coffee_shop_id=ord.coffee_shop_id AND oi.order_id=ord.id
            AND oi.promotion_id_snapshot=o.promotion_id AND oi.discount_amount_toman>0
        ))) AS "appliedOrderCount"
      FROM tenant_crm_offer_audience_members a JOIN tenant_crm_offers o ON o.coffee_shop_id=a.coffee_shop_id AND o.id=a.offer_id
      JOIN promotions p ON p.coffee_shop_id=o.coffee_shop_id AND p.id=o.promotion_id
      WHERE a.coffee_shop_id=$1 AND a.client_id=$2 ORDER BY a.granted_at DESC,a.id DESC LIMIT $3 OFFSET $4`, values);
    return { items, total: Number(count?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  private async assertPromotion(manager: import("typeorm").EntityManager, coffeeShopId: string, promotionId: string) {
    const promotion = await manager.findOne(PromotionEntity, { where: { id: promotionId, coffeeShopId } });
    if (!promotion) throw new NotFoundException("Discount not found");
  }

  private selectSql() {
    return `SELECT o.id,o.name,o.description,o.promotion_id AS "promotionId",o.segment_id AS "segmentId",o.status,
      o.activated_at AS "activatedAt",o.ended_at AS "endedAt",o.segment_name_snapshot AS "segmentNameSnapshot",
      o.segment_criteria_snapshot AS "segmentCriteriaSnapshot",o.created_at AS "createdAt",o.updated_at AS "updatedAt",
      p.name AS "promotionName",p.reward_type AS "rewardType",p.reward_value::text AS "rewardValue",p.is_active AS "promotionActive",
      p.start_at AS "promotionStartsAt",p.end_at AS "promotionEndsAt",s.name AS "segmentName",
      (SELECT COUNT(*)::int FROM tenant_crm_offer_audience_members a WHERE a.coffee_shop_id=o.coffee_shop_id AND a.offer_id=o.id) AS "audienceCount",
      (SELECT COUNT(*)::int FROM promotion_redemptions r WHERE r.coffee_shop_id=o.coffee_shop_id AND r.promotion_id=o.promotion_id
        AND r.status='APPLIED' AND r.created_at>=o.activated_at AND (o.ended_at IS NULL OR r.created_at<o.ended_at)) AS "redemptionCount",
      (SELECT COUNT(DISTINCT ord.id)::int FROM orders ord WHERE ord.coffee_shop_id=o.coffee_shop_id
        AND ord.created_at>=o.activated_at AND (o.ended_at IS NULL OR ord.created_at<o.ended_at)
        AND ((ord.order_promotion_id_snapshot=o.promotion_id AND ord.order_discount_toman>0) OR EXISTS (
          SELECT 1 FROM order_items oi WHERE oi.coffee_shop_id=ord.coffee_shop_id AND oi.order_id=ord.id
            AND oi.promotion_id_snapshot=o.promotion_id AND oi.discount_amount_toman>0
        ))) AS "appliedOrderCount"
      FROM tenant_crm_offers o JOIN promotions p ON p.coffee_shop_id=o.coffee_shop_id AND p.id=o.promotion_id
      JOIN tenant_crm_segments s ON s.coffee_shop_id=o.coffee_shop_id AND s.id=o.segment_id`;
  }

  private clean(value?: string | null) { return value?.trim() || null; }

  private throwConflict(error: unknown): never {
    const constraint = (error as { driverError?: { constraint?: string } })?.driverError?.constraint;
    if (constraint === "UQ_tenant_crm_offers_promotion") throw new ConflictException({ code: "TENANT_CRM_OFFER_PROMOTION_IN_USE", message: "این تخفیف به پیشنهاد دیگری متصل است." });
    throw error;
  }
}
