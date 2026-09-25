import { AdvancedPromotionType, PromotionRuleGroupRole, PromotionRewardType } from "./entities";
import { discountFor, PricingPromotion } from "./promotion-pricing.util";

export type AdvancedRuleTarget = { menuItemId: string | null; categoryId: string | null };
export type AdvancedRuleGroup = { role: PromotionRuleGroupRole; position: number; quantity: number; targets: AdvancedRuleTarget[] };
export type AdvancedRuleTier = { minimumQuantity: number; rewardType: PromotionRewardType.Percentage | PromotionRewardType.FixedAmount; rewardValue: string };
export type AdvancedRule = { type: AdvancedPromotionType; repeatable: boolean; groups: AdvancedRuleGroup[]; tiers: AdvancedRuleTier[] };
export type AdvancedPromotion = PricingPromotion & { advancedRule: AdvancedRule };
export type PricingUnit = {
  key: string;
  menuItemId: string;
  categoryId: string;
  variantId: string | null;
  itemName: string;
  variantName: string | null;
  unitIndex: number;
  originalPriceToman: string;
  unitPriceToman: string;
  discountAmountToman: string;
  promotion: PricingPromotion | null;
  promotionTypeSnapshot: string | null;
  promotionAllocationTypeSnapshot: string | null;
  promotionRuleSnapshot: string | null;
};

const stableUnits = (a: PricingUnit, b: PricingUnit) => a.menuItemId.localeCompare(b.menuItemId)
  || (a.variantId ?? "").localeCompare(b.variantId ?? "") || a.unitIndex - b.unitIndex;
const rewardDiscount = (unit: PricingUnit, promotion: PricingPromotion, rewardType = promotion.rewardType, rewardValue = promotion.rewardValue) =>
  discountFor(BigInt(unit.originalPriceToman), { ...promotion, rewardType, rewardValue });

function wins(unit: PricingUnit, promotion: PricingPromotion, discount: bigint) {
  const current = BigInt(unit.discountAmountToman);
  return discount > current || (discount === current && discount > 0n && Boolean(unit.promotion)
    && (promotion.priority > unit.promotion!.priority || (promotion.priority === unit.promotion!.priority && promotion.id < unit.promotion!.id)));
}

function applyReward(unit: PricingUnit, promotion: AdvancedPromotion, allocationType: "GET" | "QUANTITY_TIER", rewardType: PromotionRewardType, rewardValue: string, summary: string) {
  const discount = rewardDiscount(unit, promotion, rewardType, rewardValue);
  if (!wins(unit, promotion, discount)) return unit;
  return {
    ...unit, unitPriceToman: (BigInt(unit.originalPriceToman) - discount).toString(), discountAmountToman: discount.toString(),
    promotion: { ...promotion, rewardType, rewardValue }, promotionTypeSnapshot: promotion.advancedRule.type,
    promotionAllocationTypeSnapshot: allocationType, promotionRuleSnapshot: summary,
  };
}

function matches(unit: PricingUnit, group: AdvancedRuleGroup) {
  return group.targets.some((target) => target.menuItemId === unit.menuItemId || target.categoryId === unit.categoryId);
}

function group(rule: AdvancedRule, role: PromotionRuleGroupRole) {
  return rule.groups.find((candidate) => candidate.role === role);
}

function uniqueUnits(units: PricingUnit[]) { return [...new Map(units.map((unit) => [unit.key, unit])).values()]; }

function summaryForBuyGet(promotion: AdvancedPromotion, buy: AdvancedRuleGroup, get: AdvancedRuleGroup) {
  const reward = promotion.rewardType === PromotionRewardType.Percentage ? `${promotion.rewardValue}%` : `${promotion.rewardValue} تومان`;
  return `${promotion.name}: ${buy.quantity} بخرید، ${get.quantity} پاداش با ${reward} تخفیف`;
}

function applyBuyGet(units: PricingUnit[], promotion: AdvancedPromotion, consumed: Set<string>) {
  const buy = group(promotion.advancedRule, PromotionRuleGroupRole.Buy);
  const get = group(promotion.advancedRule, PromotionRuleGroupRole.Get);
  if (!buy || !get) return units;
  let output = units;
  const selected = new Set<string>();
  const summary = summaryForBuyGet(promotion, buy, get);
  for (let cycle = 0; cycle < 50; cycle++) {
    if (cycle && !promotion.advancedRule.repeatable) break;
    const buyUnits = output.filter((unit) => !consumed.has(unit.key) && !selected.has(unit.key) && matches(unit, buy))
      .sort((a, b) => BigInt(b.originalPriceToman) > BigInt(a.originalPriceToman) ? 1 : BigInt(b.originalPriceToman) < BigInt(a.originalPriceToman) ? -1 : stableUnits(a, b)).slice(0, buy.quantity);
    if (buyUnits.length < buy.quantity) break;
    const buyKeys = new Set(buyUnits.map((unit) => unit.key));
    const getUnits = output.filter((unit) => !consumed.has(unit.key) && !selected.has(unit.key) && !buyKeys.has(unit.key) && matches(unit, get)
      && wins(unit, promotion, rewardDiscount(unit, promotion)))
      .sort((a, b) => BigInt(a.originalPriceToman) < BigInt(b.originalPriceToman) ? -1 : BigInt(a.originalPriceToman) > BigInt(b.originalPriceToman) ? 1 : stableUnits(a, b)).slice(0, get.quantity);
    if (getUnits.length < get.quantity) break;
    const updated = new Map(getUnits.map((unit) => [unit.key, applyReward(unit, promotion, "GET", promotion.rewardType, promotion.rewardValue, summary)]));
    if (![...updated.values()].some((unit, index) => unit.promotion?.id === promotion.id && getUnits[index]?.promotion?.id !== promotion.id)) break;
    output = output.map((unit) => updated.get(unit.key) ?? unit);
    for (const unit of [...buyUnits, ...getUnits]) { selected.add(unit.key); consumed.add(unit.key); }
  }
  return output;
}

function allocateProportionally(units: PricingUnit[], totalDiscount: bigint) {
  const ordered = [...units].sort(stableUnits);
  const total = ordered.reduce((sum, unit) => sum + BigInt(unit.originalPriceToman), 0n);
  const shares = ordered.map((unit) => total ? BigInt(unit.originalPriceToman) * totalDiscount / total : 0n);
  let remainder = totalDiscount - shares.reduce((sum, share) => sum + share, 0n);
  for (let index = 0; remainder > 0n && index < ordered.length; index++) {
    if (BigInt(ordered[index]!.originalPriceToman) > shares[index]!) { shares[index]! += 1n; remainder--; }
    if (index === ordered.length - 1 && remainder > 0n) index = -1;
  }
  return new Map(ordered.map((unit, index) => [unit.key, shares[index]!]));
}

function applyBundle(units: PricingUnit[], promotion: AdvancedPromotion, consumed: Set<string>) {
  const groups = promotion.advancedRule.groups.filter((candidate) => candidate.role === PromotionRuleGroupRole.BundleItem).sort((a, b) => a.position - b.position);
  if (groups.length < 2) return units;
  let output = units;
  const selected = new Set<string>();
  const bundlePrice = BigInt(promotion.rewardValue);
  for (let cycle = 0; cycle < 50; cycle++) {
    if (cycle && !promotion.advancedRule.repeatable) break;
    const participants: PricingUnit[] = [];
    for (const component of groups) {
      const candidates = output.filter((unit) => !consumed.has(unit.key) && !selected.has(unit.key) && !participants.some((current) => current.key === unit.key) && matches(unit, component))
        .sort((a, b) => BigInt(a.originalPriceToman) < BigInt(b.originalPriceToman) ? -1 : BigInt(a.originalPriceToman) > BigInt(b.originalPriceToman) ? 1 : stableUnits(a, b));
      if (candidates.length < component.quantity) { participants.length = 0; break; }
      participants.push(...candidates.slice(0, component.quantity));
    }
    if (!participants.length) break;
    const original = participants.reduce((sum, unit) => sum + BigInt(unit.originalPriceToman), 0n);
    const current = participants.reduce((sum, unit) => sum + BigInt(unit.unitPriceToman), 0n);
    if (bundlePrice >= original || bundlePrice >= current) break;
    const shares = allocateProportionally(participants, original - bundlePrice);
    const updated = new Map(participants.map((unit) => {
      const discount = shares.get(unit.key)!;
      return [unit.key, {
        ...unit, unitPriceToman: (BigInt(unit.originalPriceToman) - discount).toString(), discountAmountToman: discount.toString(),
        promotion, promotionTypeSnapshot: promotion.advancedRule.type, promotionAllocationTypeSnapshot: "BUNDLE",
        promotionRuleSnapshot: `${promotion.name}: قیمت بسته ${bundlePrice} تومان`,
      } satisfies PricingUnit] as const;
    }));
    output = output.map((unit) => updated.get(unit.key) ?? unit);
    for (const unit of participants) { selected.add(unit.key); consumed.add(unit.key); }
  }
  return output;
}

function applyQuantityTier(units: PricingUnit[], promotion: AdvancedPromotion, consumed: Set<string>) {
  const target = group(promotion.advancedRule, PromotionRuleGroupRole.QuantityTarget);
  if (!target) return units;
  const eligible = units.filter((unit) => !consumed.has(unit.key) && matches(unit, target)).sort(stableUnits);
  const tier = [...promotion.advancedRule.tiers].sort((a, b) => a.minimumQuantity - b.minimumQuantity)
    .filter((candidate) => candidate.minimumQuantity <= eligible.length).at(-1);
  if (!tier) return units;
  const summary = `${promotion.name}: از ${tier.minimumQuantity} عدد، ${tier.rewardType === PromotionRewardType.Percentage ? `${tier.rewardValue}% تخفیف` : `${tier.rewardValue} تومان تخفیف`}`;
  const updated = new Map(eligible.map((unit) => [unit.key, applyReward(unit, promotion, "QUANTITY_TIER", tier.rewardType, tier.rewardValue, summary)]));
  if (![...updated.values()].some((unit, index) => unit.promotion?.id === promotion.id && eligible[index]?.promotion?.id !== promotion.id)) return units;
  for (const unit of eligible) consumed.add(unit.key);
  return units.map((unit) => updated.get(unit.key) ?? unit);
}

export function applyAdvancedPromotions(cartUnits: PricingUnit[], promotions: AdvancedPromotion[]) {
  let units = cartUnits.map((unit) => ({ ...unit }));
  const consumed = new Set<string>();
  const ordered = [...promotions].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const promotion of ordered) {
    if (promotion.advancedRule.type === AdvancedPromotionType.BuyXGetY) units = applyBuyGet(units, promotion, consumed);
    else if (promotion.advancedRule.type === AdvancedPromotionType.Bundle) units = applyBundle(units, promotion, consumed);
    else units = applyQuantityTier(units, promotion, consumed);
  }
  return units;
}
