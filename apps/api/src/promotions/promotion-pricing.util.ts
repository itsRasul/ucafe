import { PromotionRewardType } from "./entities";

export type PricingPromotion = { id: string; name: string; priority: number; rewardType: PromotionRewardType; rewardValue: string };
export type PriceResult = { originalPriceToman: string; finalPriceToman: string; discountAmountToman: string; promotion: PricingPromotion | null };

export function promotionStatus(promotion: { isActive: boolean; startAt: Date | null; endAt: Date | null; deletedAt?: Date | null }, now: Date) {
  if (promotion.deletedAt) return "ARCHIVED" as const;
  if (!promotion.isActive) return "INACTIVE" as const;
  if (promotion.startAt && promotion.startAt.getTime() > now.getTime()) return "UPCOMING" as const;
  if (promotion.endAt && promotion.endAt.getTime() <= now.getTime()) return "EXPIRED" as const;
  return "RUNNING" as const;
}

function discountFor(price: bigint, promotion: PricingPromotion) {
  const value = BigInt(promotion.rewardValue);
  if (promotion.rewardType === PromotionRewardType.Percentage) return (price * value + 50n) / 100n;
  if (promotion.rewardType === PromotionRewardType.FixedAmount) return value < price ? value : price;
  const finalPrice = value < price ? value : price;
  return price - finalPrice;
}

export function priceWithPromotion(priceToman: string, promotions: PricingPromotion[]): PriceResult {
  const price = BigInt(priceToman);
  let winner: PricingPromotion | null = null;
  let bestDiscount = 0n;
  for (const promotion of promotions) {
    const discount = discountFor(price, promotion);
    if (discount > bestDiscount || (discount === bestDiscount && discount > 0n && winner && (promotion.priority > winner.priority || (promotion.priority === winner.priority && promotion.id.localeCompare(winner.id) < 0)))) {
      winner = promotion;
      bestDiscount = discount;
    }
  }
  return { originalPriceToman: price.toString(), finalPriceToman: (price - bestDiscount).toString(), discountAmountToman: bestDiscount.toString(), promotion: winner };
}
