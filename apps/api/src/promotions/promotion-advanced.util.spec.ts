import assert from "node:assert/strict";
import test from "node:test";
import { AdvancedPromotionType, PromotionRewardType, PromotionRuleGroupRole } from "./entities";
import { AdvancedPromotion, AdvancedRuleGroup, PricingUnit, applyAdvancedPromotions } from "./promotion-advanced.util";

function unit(menuItemId: string, categoryId: string, price: number, unitIndex = 0, variantId: string | null = null, promotion: PricingUnit["promotion"] = null): PricingUnit {
  const discount = promotion ? (BigInt(price) * BigInt(promotion.rewardValue) / BigInt(100)).toString() : "0";
  return {
    key: `${menuItemId}:${variantId ?? ""}:${unitIndex}`, menuItemId, categoryId, variantId, itemName: menuItemId, variantName: null,
    unitIndex, originalPriceToman: String(price), unitPriceToman: String(price - Number(discount)), discountAmountToman: discount,
    promotion, promotionTypeSnapshot: null, promotionAllocationTypeSnapshot: null, promotionRuleSnapshot: null,
  };
}

function group(role: PromotionRuleGroupRole, quantity: number, targets: Array<{ menuItemId?: string; categoryId?: string }>, position = 0): AdvancedRuleGroup {
  return { role, position, quantity, targets: targets.map((target) => ({ menuItemId: target.menuItemId ?? null, categoryId: target.categoryId ?? null })) };
}

function promotion(type: AdvancedPromotionType, groups: AdvancedRuleGroup[], rewardType: PromotionRewardType, rewardValue: string, options: { repeatable?: boolean; tiers?: AdvancedPromotion["advancedRule"]["tiers"]; id?: string; priority?: number } = {}): AdvancedPromotion {
  return {
    id: options.id ?? "advanced", name: "Special", priority: options.priority ?? 1, rewardType, rewardValue,
    advancedRule: { type, repeatable: options.repeatable ?? true, groups, tiers: options.tiers ?? [] },
  };
}

function discounted(units: PricingUnit[], promotionId = "advanced") { return units.filter((item) => item.promotion?.id === promotionId); }

test("Buy 1 Get 1 and repeatable Buy 2 Get 1 consume distinct cart units", () => {
  const bogo = promotion(AdvancedPromotionType.BuyXGetY, [group(PromotionRuleGroupRole.Buy, 1, [{ menuItemId: "coffee" }]), group(PromotionRuleGroupRole.Get, 1, [{ menuItemId: "coffee" }])], PromotionRewardType.Percentage, "100");
  assert.equal(discounted(applyAdvancedPromotions([unit("coffee", "drinks", 100, 0)], [bogo])).length, 0);
  assert.equal(discounted(applyAdvancedPromotions([unit("coffee", "drinks", 100, 0), unit("coffee", "drinks", 100, 1)], [bogo])).length, 1);
  assert.equal(discounted(applyAdvancedPromotions([0, 1, 2].map((index) => unit("coffee", "drinks", 100, index)), [bogo])).length, 1);

  const buyTwo = promotion(AdvancedPromotionType.BuyXGetY, [group(PromotionRuleGroupRole.Buy, 2, [{ categoryId: "drinks" }]), group(PromotionRuleGroupRole.Get, 1, [{ categoryId: "drinks" }])], PromotionRewardType.Percentage, "100");
  const cases: Array<[number, number]> = [[2, 0], [3, 1], [5, 1], [6, 2]];
  for (const [quantity, free] of cases) {
    const result = applyAdvancedPromotions(Array.from({ length: quantity }, (_, index) => unit("coffee", "drinks", 100, index)), [buyTwo]);
    assert.equal(discounted(result).length, free, `quantity ${quantity}`);
    assert.equal(result.length, quantity);
  }
  const once = promotion(AdvancedPromotionType.BuyXGetY, buyTwo.advancedRule.groups, PromotionRewardType.Percentage, "100", { repeatable: false });
  assert.equal(discounted(applyAdvancedPromotions(Array.from({ length: 6 }, (_, index) => unit("coffee", "drinks", 100, index)), [once])).length, 1);
});

test("Buy/Get with different targets chooses the cheapest selected reward and never reuses one unit", () => {
  const rule = promotion(AdvancedPromotionType.BuyXGetY, [group(PromotionRuleGroupRole.Buy, 1, [{ menuItemId: "burger" }]), group(PromotionRuleGroupRole.Get, 1, [{ categoryId: "dessert" }])], PromotionRewardType.Percentage, "100");
  const result = applyAdvancedPromotions([unit("cake-high", "dessert", 900), unit("burger", "food", 500), unit("cake-low", "dessert", 300)], [rule]);
  assert.deepEqual(discounted(result).map((item) => item.menuItemId), ["cake-low"]);
  const sale = { id: "sale", name: "Half price", priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: "50" };
  const discountedChoice = applyAdvancedPromotions([unit("cake-high", "dessert", 900, 0, null, sale), unit("burger", "food", 500), unit("cake-low", "dessert", 500)], [rule]);
  assert.deepEqual(discounted(discountedChoice).map((item) => item.menuItemId), ["cake-low"]);
  const variants = [unit("latte", "coffee", 150, 0, "small"), unit("latte", "coffee", 250, 0, "large")];
  const variantPromotion = promotion(AdvancedPromotionType.BuyXGetY, [group(PromotionRuleGroupRole.Buy, 1, [{ menuItemId: "latte" }]), group(PromotionRuleGroupRole.Get, 1, [{ menuItemId: "latte" }])], PromotionRewardType.Percentage, "100");
  const variantResult = applyAdvancedPromotions(variants, [variantPromotion]);
  assert.equal(discounted(variantResult)[0]?.variantId, "small");
  const overlap = promotion(AdvancedPromotionType.BuyXGetY, [group(PromotionRuleGroupRole.Buy, 1, [{ categoryId: "drinks" }]), group(PromotionRuleGroupRole.Get, 1, [{ categoryId: "drinks" }])], PromotionRewardType.Percentage, "100");
  assert.equal(discounted(applyAdvancedPromotions([unit("coffee", "drinks", 100)], [overlap])).length, 0);
});

test("bundle quantities require complete sets and allocate rounded discounts exactly", () => {
  const bundle = promotion(AdvancedPromotionType.Bundle, [group(PromotionRuleGroupRole.BundleItem, 1, [{ menuItemId: "latte" }], 0), group(PromotionRuleGroupRole.BundleItem, 1, [{ menuItemId: "croissant" }], 1)], PromotionRewardType.FixedPrice, "250", { repeatable: true });
  const partial = applyAdvancedPromotions([unit("latte", "coffee", 200)], [bundle]);
  assert.equal(discounted(partial).length, 0);
  const exact = applyAdvancedPromotions([unit("croissant", "bakery", 101), unit("latte", "coffee", 200)], [bundle]);
  assert.equal(exact.reduce((sum, item) => sum + BigInt(item.unitPriceToman), BigInt(0)), BigInt(250));
  assert.equal(exact.reduce((sum, item) => sum + BigInt(item.discountAmountToman), BigInt(0)), BigInt(51));
  assert.deepEqual(exact.map((item) => [item.menuItemId, item.discountAmountToman]).sort(), [["croissant", "18"], ["latte", "33"]]);
  const repeated = promotion(AdvancedPromotionType.Bundle, bundle.advancedRule.groups, PromotionRewardType.FixedPrice, "250");
  const twice = applyAdvancedPromotions([unit("latte", "coffee", 200, 0), unit("latte", "coffee", 200, 1), unit("croissant", "bakery", 101, 0), unit("croissant", "bakery", 101, 1)], [repeated]);
  assert.equal(twice.reduce((sum, item) => sum + BigInt(item.unitPriceToman), BigInt(0)), BigInt(500));
});

test("quantity tiers aggregate category units, select the highest tier, and discount eligible units only", () => {
  const rule = promotion(AdvancedPromotionType.QuantityTier, [group(PromotionRuleGroupRole.QuantityTarget, 1, [{ categoryId: "cold-drinks" }])], PromotionRewardType.Percentage, "1", {
    tiers: [{ minimumQuantity: 3, rewardType: PromotionRewardType.Percentage, rewardValue: "10" }, { minimumQuantity: 5, rewardType: PromotionRewardType.Percentage, rewardValue: "15" }, { minimumQuantity: 10, rewardType: PromotionRewardType.Percentage, rewardValue: "20" }],
  });
  const cart = ["cola", "juice", "latte", "water", "tea"].map((id, index) => unit(id, "cold-drinks", 1000, index)).concat(unit("cake", "dessert", 1000));
  const result = applyAdvancedPromotions(cart, [rule]);
  assert.equal(discounted(result).length, 5);
  assert.ok(discounted(result).every((item) => item.unitPriceToman === "850" && item.promotion?.rewardValue === "15"));
  assert.equal(result.find((item) => item.menuItemId === "cake")?.unitPriceToman, "1000");
});

test("advanced rewards replace rather than stack with per-item discounts and input order is irrelevant", () => {
  const sale = { id: "sale", name: "Sale", priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: "10" };
  const coupon = promotion(AdvancedPromotionType.QuantityTier, [group(PromotionRuleGroupRole.QuantityTarget, 1, [{ menuItemId: "coffee" }])], PromotionRewardType.Percentage, "1", {
    tiers: [{ minimumQuantity: 2, rewardType: PromotionRewardType.Percentage, rewardValue: "20" }], priority: 4,
  });
  const cart = [unit("coffee", "drinks", 1000, 0, null, sale), unit("coffee", "drinks", 1000, 1, null, sale)];
  const a = applyAdvancedPromotions(cart, [coupon]).sort((x, y) => x.key.localeCompare(y.key));
  const b = applyAdvancedPromotions([...cart].reverse(), [coupon]).sort((x, y) => x.key.localeCompare(y.key));
  assert.deepEqual(a.map(({ key, unitPriceToman, promotionTypeSnapshot }) => [key, unitPriceToman, promotionTypeSnapshot]), b.map(({ key, unitPriceToman, promotionTypeSnapshot }) => [key, unitPriceToman, promotionTypeSnapshot]));
  assert.ok(a.every((item) => item.unitPriceToman === "800"));
});
