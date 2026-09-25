import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { IsNull } from "typeorm";
import { Promotion, PromotionRuleGroupRole, PromotionTarget } from "./entities";
import { PriceResult, PricingPromotion, priceWithPromotion, promotionStatus } from "./promotion-pricing.util";
import { AdvancedPromotion, PricingUnit, applyAdvancedPromotions } from "./promotion-advanced.util";

export type PricingContext = { product: Map<string, PricingPromotion[]>; category: Map<string, PricingPromotion[]>; order: Promotion[]; advanced: AdvancedPromotion[] };

@Injectable()
export class PromotionPricingService {
  async loadContext(manager: EntityManager, coffeeShopId: string, now: Date, timezone: string): Promise<PricingContext> {
    const promotions = await manager.find(Promotion, { where: { coffeeShopId, isActive: true, deletedAt: IsNull() }, relations: { targets: true, coupon: true, scheduleWindows: true, advancedRule: { groups: { targets: true }, tiers: true } }, relationLoadStrategy: "query" });
    const context: PricingContext = { product: new Map(), category: new Map(), order: [], advanced: [] };
    for (const promotion of promotions) {
      if (promotionStatus(promotion, now, timezone) !== "RUNNING") continue;
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
