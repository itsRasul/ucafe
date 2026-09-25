import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { IsNull } from "typeorm";
import { Promotion, PromotionTarget } from "./entities";
import { PriceResult, PricingPromotion, priceWithPromotion, promotionStatus } from "./promotion-pricing.util";

export type PricingContext = { product: Map<string, PricingPromotion[]>; category: Map<string, PricingPromotion[]>; order: Promotion[] };

@Injectable()
export class PromotionPricingService {
  async loadContext(manager: EntityManager, coffeeShopId: string, now: Date): Promise<PricingContext> {
    const promotions = await manager.find(Promotion, { where: { coffeeShopId, isActive: true, deletedAt: IsNull() }, relations: { targets: true, coupon: true } });
    const context: PricingContext = { product: new Map(), category: new Map(), order: [] };
    for (const promotion of promotions) {
      if (promotionStatus(promotion, now) !== "RUNNING") continue;
      if (promotion.coupon) continue;
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
}
