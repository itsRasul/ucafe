import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { In, IsNull } from "typeorm";
import { COMPLETED_ORDER_STATUS } from "../ordering/order-status.util";
import { Promotion, PromotionCustomerConditionType, PromotionRedemption, PromotionRuleGroupRole, RedemptionStatus } from "./entities";
import { PriceResult, PricingPromotion, priceWithPromotion, promotionStatus } from "./promotion-pricing.util";
import { AdvancedPromotion, PricingUnit, applyAdvancedPromotions } from "./promotion-advanced.util";
import { CustomerEligibilityFailure, CustomerEvaluationContext, customerConditionFailure } from "./promotion-customer-condition.util";

export type PricingContext = {
  product: Map<string, PricingPromotion[]>;
  category: Map<string, PricingPromotion[]>;
  order: Promotion[];
  advanced: AdvancedPromotion[];
  eligiblePromotions: Map<string, Promotion>;
  customerContext: CustomerEvaluationContext | null;
  customerFailures: Map<string, CustomerEligibilityFailure>;
};

@Injectable()
export class PromotionPricingService {
  async loadContext(manager: EntityManager, coffeeShopId: string, now: Date, timezone: string, clientId?: string): Promise<PricingContext> {
    const promotions = await manager.find(Promotion, { where: { coffeeShopId, isActive: true, deletedAt: IsNull() }, relations: { targets: true, coupon: true, scheduleWindows: true, advancedRule: { groups: { targets: true }, tiers: true }, customerConditions: true }, relationLoadStrategy: "query" });
    const customerContext = await this.customerContext(manager, coffeeShopId, clientId, promotions);
    const context: PricingContext = { product: new Map(), category: new Map(), order: [], advanced: [], eligiblePromotions: new Map(), customerContext, customerFailures: new Map() };
    for (const promotion of promotions) {
      if (promotionStatus(promotion, now, timezone) !== "RUNNING") continue;
      const failure = customerConditionFailure(promotion.id, promotion.customerConditions ?? [], customerContext, now);
      if (failure) { context.customerFailures.set(promotion.id, failure); continue; }
      context.eligiblePromotions.set(promotion.id, promotion);
      if (promotion.coupon) continue;
      if (promotion.advancedRule) { context.advanced.push(this.advancedCandidate(promotion)); continue; }
      if (promotion.entireOrder) { context.order.push(promotion); continue; }
      const entry = { id: promotion.id, name: promotion.name, priority: promotion.priority, rewardType: promotion.rewardType, rewardValue: promotion.rewardValue };
      for (const target of promotion.targets) {
        const [map, id] = target.menuItemId ? [context.product, target.menuItemId] : [context.category, target.categoryId!];
        const entries = map.get(id) ?? [];
        entries.push(entry);
        map.set(id, entries);
      }
    }
    return context;
  }

  customerFailure(promotion: Promotion, context: PricingContext, now: Date) {
    return context.customerFailures.get(promotion.id) ?? customerConditionFailure(promotion.id, promotion.customerConditions ?? [], context.customerContext, now);
  }

  private async customerContext(manager: EntityManager, coffeeShopId: string, clientId: string | undefined, promotions: Promotion[]): Promise<CustomerEvaluationContext | null> {
    if (!clientId) return null;
    const conditional = promotions.filter((promotion) => promotion.customerConditions?.length);
    if (!conditional.length) return null;
    const rows = await manager.query<Array<{ registeredAt: Date; completedOrderCount: string; completedSpendToman: string; lastCompletedOrderAt: Date | null }>>(`
      SELECT c.created_at AS "registeredAt", COUNT(o.id)::text AS "completedOrderCount",
             COALESCE(SUM(o.total_amount_toman), 0)::text AS "completedSpendToman",
             MAX(o.status_changed_at) AS "lastCompletedOrderAt"
      FROM clients c LEFT JOIN orders o ON o.coffee_shop_id = c.coffee_shop_id AND o.client_id = c.id AND o.status = $3
      WHERE c.coffee_shop_id = $1 AND c.id = $2 GROUP BY c.id
    `, [coffeeShopId, clientId, COMPLETED_ORDER_STATUS]);
    const row = rows[0];
    if (!row) return null;

    const segmentIds = [...new Set(conditional.flatMap((promotion) => (promotion.customerConditions ?? []).map((condition) => condition.customerSegmentId).filter((id): id is string => Boolean(id))))];
    const segmentRows = segmentIds.length ? await manager.query<Array<{ id: string; name: string; isActive: boolean; deletedAt: Date | null; isMember: boolean }>>(`
      SELECT s.id, s.name, s.is_active AS "isActive", s.deleted_at AS "deletedAt",
             EXISTS (SELECT 1 FROM customer_segment_memberships m WHERE m.coffee_shop_id = s.coffee_shop_id AND m.segment_id = s.id AND m.client_id = $2) AS "isMember"
      FROM customer_segments s WHERE s.coffee_shop_id = $1 AND s.id = ANY($3::uuid[])
    `, [coffeeShopId, clientId, segmentIds]) : [];
    const segmentById = new Map(segmentRows.map((segment) => [segment.id, segment]));
    for (const promotion of conditional) for (const condition of promotion.customerConditions ?? []) {
      condition.customerSegmentName = condition.customerSegmentId ? segmentById.get(condition.customerSegmentId)?.name ?? null : null;
    }
    const firstOrderPromotionIds = conditional.filter((promotion) => promotion.customerConditions!.some((condition) => condition.type === PromotionCustomerConditionType.FirstOrder)).map((promotion) => promotion.id);
    const claimRows = firstOrderPromotionIds.length ? await manager.find(PromotionRedemption, { where: { coffeeShopId, customerId: clientId, promotionId: In(firstOrderPromotionIds), isFirstOrderClaim: true, status: RedemptionStatus.Applied }, select: { promotionId: true } }) : [];
    return {
      customerId: clientId,
      stats: {
        completedOrderCount: BigInt(row.completedOrderCount), completedSpendToman: BigInt(row.completedSpendToman),
        lastCompletedOrderAt: row.lastCompletedOrderAt ? new Date(row.lastCompletedOrderAt) : null,
        registeredAt: new Date(row.registeredAt),
      },
      segmentIds: new Set(segmentRows.filter((segment) => segment.isActive && !segment.deletedAt && segment.isMember).map((segment) => segment.id)),
      firstOrderClaims: new Set(claimRows.map((claim) => claim.promotionId)),
    };
  }

  price(context: PricingContext, menuItemId: string, categoryId: string, priceToman: string): PriceResult {
    const byId = new Map<string, PricingPromotion>();
    for (const promotion of [...(context.product.get(menuItemId) ?? []), ...(context.category.get(categoryId) ?? [])]) byId.set(promotion.id, promotion);
    return priceWithPromotion(priceToman, [...byId.values()]);
  }

  priceCart(context: PricingContext, units: PricingUnit[], supplemental: Promotion[] = []) {
    return applyAdvancedPromotions(units, [...context.advanced, ...supplemental.filter((promotion) => Boolean(promotion.advancedRule)).map((promotion) => this.advancedCandidate(promotion))]);
  }

  private advancedCandidate(promotion: Promotion): AdvancedPromotion {
    const rule = promotion.advancedRule!;
    return {
      id: promotion.id, name: promotion.name, priority: promotion.priority, rewardType: promotion.rewardType, rewardValue: promotion.rewardValue,
      advancedRule: {
        type: rule.type, repeatable: rule.repeatable,
        groups: [...(rule.groups ?? [])].sort((a, b) => a.role.localeCompare(b.role) || a.position - b.position).map((group) => ({
          role: group.role as PromotionRuleGroupRole, position: group.position, quantity: group.quantity,
          targets: (group.targets ?? []).map(({ menuItemId, categoryId }) => ({ menuItemId, categoryId })),
        })),
        tiers: [...(rule.tiers ?? [])].map(({ minimumQuantity, rewardType, rewardValue }) => ({ minimumQuantity, rewardType, rewardValue })),
      },
    };
  }
}
