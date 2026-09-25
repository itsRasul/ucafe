import assert from "node:assert/strict";
import test from "node:test";
import { Promotion, PromotionRewardType as Reward } from "./entities";
import { PromotionPricingService } from "./promotion-pricing.service";

test("pricing resolves product and category targets in tenant scope, with the best reward winning", async () => {
  const now = new Date("2026-09-25T12:00:00.000Z");
  const promotions = [
    { id: "category", coffeeShopId: "tenant-a", name: "Coffee", isActive: true, startAt: null, endAt: null, deletedAt: null, priority: 0, rewardType: Reward.Percentage, rewardValue: "20", targets: [{ menuItemId: null, categoryId: "coffee" }] },
    { id: "product", coffeeShopId: "tenant-a", name: "Latte", isActive: true, startAt: null, endAt: null, deletedAt: null, priority: 1, rewardType: Reward.FixedAmount, rewardValue: "30000", targets: [{ menuItemId: "latte", categoryId: null }] },
    { id: "foreign", coffeeShopId: "tenant-b", name: "Foreign", isActive: true, startAt: null, endAt: null, deletedAt: null, priority: 100, rewardType: Reward.FixedAmount, rewardValue: "90000", targets: [{ menuItemId: "latte", categoryId: null }] },
    { id: "inactive", coffeeShopId: "tenant-a", name: "Inactive", isActive: false, startAt: null, endAt: null, deletedAt: null, priority: 100, rewardType: Reward.FixedAmount, rewardValue: "90000", targets: [{ menuItemId: "latte", categoryId: null }] },
    { id: "upcoming", coffeeShopId: "tenant-a", name: "Upcoming", isActive: true, startAt: new Date(now.getTime() + 1000), endAt: null, deletedAt: null, priority: 100, rewardType: Reward.FixedAmount, rewardValue: "90000", targets: [{ menuItemId: "latte", categoryId: null }] },
  ];
  const manager = { find: async (entity: unknown, options: { where: { coffeeShopId: string } }) => {
    assert.equal(entity, Promotion);
    assert.equal(options.where.coffeeShopId, "tenant-a");
    return promotions.filter((promotion) => promotion.coffeeShopId === options.where.coffeeShopId && promotion.isActive && !promotion.deletedAt);
  } };
  const pricing = new PromotionPricingService();
  const context = await pricing.loadContext(manager as never, "tenant-a", now, "UTC");
  assert.equal(pricing.price(context, "latte", "coffee", "100000").finalPriceToman, "70000");
  assert.equal(pricing.price(context, "flat-white", "coffee", "100000").finalPriceToman, "80000");
  assert.equal(pricing.price(context, "tea", "tea", "100000").finalPriceToman, "100000");
});
