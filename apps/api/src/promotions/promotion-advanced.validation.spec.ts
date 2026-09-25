import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { AdvancedPromotionType, PromotionRewardType } from "./entities";
import { PromotionsService } from "./promotions.service";

const promotions = new PromotionsService({} as never);
const base = { name: "Advanced", priority: 0, isActive: true, entireOrder: false, targets: [] as [] };

test("advanced promotion validation rejects empty and impossible requirement groups", async () => {
  await assert.rejects(promotions.create("tenant", "actor", {
    ...base, rewardType: PromotionRewardType.Percentage, rewardValue: 100,
    advancedRule: { type: AdvancedPromotionType.BuyXGetY, buy: { quantity: 0, targets: [{ menuItemId: "coffee" }] }, get: { quantity: 1, targets: [{ menuItemId: "coffee" }] } },
  }, "UTC"), BadRequestException);
  await assert.rejects(promotions.create("tenant", "actor", {
    ...base, rewardType: PromotionRewardType.FixedPrice, rewardValue: 100,
    advancedRule: { type: AdvancedPromotionType.Bundle, bundleComponents: [{ quantity: 1, targets: [{ categoryId: "coffee" }] }] },
  }, "UTC"), BadRequestException);
});

test("quantity tiers must be unique, increasing, positive and within reward bounds", async () => {
  const tiers = (minimumQuantity: number, rewardValue: number) => [{ minimumQuantity, rewardType: PromotionRewardType.Percentage as const, rewardValue }];
  const input = (values: ReturnType<typeof tiers>) => promotions.create("tenant", "actor", {
    ...base, rewardType: PromotionRewardType.Percentage, rewardValue: 10,
    advancedRule: { type: AdvancedPromotionType.QuantityTier, quantityTarget: { quantity: 1, targets: [{ categoryId: "drinks" }] }, tiers: values },
  }, "UTC");
  await assert.rejects(input([...tiers(3, 10), ...tiers(3, 20)]), BadRequestException);
  await assert.rejects(input(tiers(3, 101)), BadRequestException);
});
