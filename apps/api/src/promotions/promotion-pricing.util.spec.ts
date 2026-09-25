import assert from "node:assert/strict";
import test from "node:test";
import { PromotionRewardType as Reward } from "./entities";
import { priceWithPromotion, promotionStatus } from "./promotion-pricing.util";

const promotion = (id: string, rewardType: Reward, rewardValue: string, priority = 0) => ({ id, name: id, priority, rewardType, rewardValue });

test("promotion pricing covers percentage, fixed amount, floor, fixed price and rounding", () => {
  assert.equal(priceWithPromotion("100000", [promotion("p", Reward.Percentage, "20")]).finalPriceToman, "80000");
  assert.equal(priceWithPromotion("100000", [promotion("p", Reward.FixedAmount, "30000")]).finalPriceToman, "70000");
  assert.equal(priceWithPromotion("100000", [promotion("p", Reward.FixedAmount, "150000")]).finalPriceToman, "0");
  assert.equal(priceWithPromotion("100000", [promotion("p", Reward.FixedPrice, "75000")]).finalPriceToman, "75000");
  assert.equal(priceWithPromotion("1", [promotion("p", Reward.Percentage, "50")]).discountAmountToman, "1");
  assert.equal(priceWithPromotion("100", [promotion("p", Reward.FixedPrice, "200")]).discountAmountToman, "0");
});

test("promotion pricing chooses the largest discount, then priority, then stable id", () => {
  const result = priceWithPromotion("100000", [promotion("z", Reward.FixedAmount, "20000", 9), promotion("b", Reward.Percentage, "20", 1), promotion("a", Reward.FixedAmount, "20000", 9)]);
  assert.equal(result.promotion?.id, "a");
  assert.equal(result.discountAmountToman, "20000");
});

test("promotion status uses start-inclusive and end-exclusive UTC instants", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");
  assert.equal(promotionStatus({ isActive: true, startAt: new Date(now), endAt: null }, now), "RUNNING");
  assert.equal(promotionStatus({ isActive: true, startAt: null, endAt: new Date(now) }, now), "EXPIRED");
  assert.equal(promotionStatus({ isActive: true, startAt: new Date(now.getTime() + 1), endAt: null }, now), "UPCOMING");
});
