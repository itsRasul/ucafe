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
  }, query: async () => [] };
  const pricing = new PromotionPricingService({ featureState: async () => ({ enabled: true }) } as never);
  const context = await pricing.loadContext(manager as never, "tenant-a", now, "UTC");
  assert.equal(pricing.price(context, "latte", "coffee", "100000").finalPriceToman, "70000");
  assert.equal(pricing.price(context, "flat-white", "coffee", "100000").finalPriceToman, "80000");
  assert.equal(pricing.price(context, "tea", "tea", "100000").finalPriceToman, "100000");
});

test("CRM Offer audience snapshots gate the existing Promotion pricing path", async () => {
  const promotion = { id: "promo", coffeeShopId: "tenant-a", name: "Comeback", isActive: true, startAt: null, endAt: null, deletedAt: null,
    priority: 0, rewardType: Reward.Percentage, rewardValue: "20", targets: [{ menuItemId: "latte", categoryId: null }], customerConditions: [] };
  const policyCalls: Array<{ sql: string; parameters: unknown[] }> = [];
  let offerRows = [{ promotionId: "promo", status: "ACTIVE", isMember: true }];
  let featureEnabled = true;
  const manager = {
    find: async () => [promotion],
    query: async (sql: string, parameters: unknown[]) => {
      policyCalls.push({ sql, parameters });
      return offerRows;
    },
  };
  const pricing = new PromotionPricingService({ featureState: async (_tenant: string, _feature: string, _now: Date, transaction: unknown) => {
    assert.equal(transaction, manager);
    return { enabled: featureEnabled };
  } } as never);

  let context = await pricing.loadContext(manager as never, "tenant-a", new Date("2026-09-29T12:00:00Z"), "UTC", "client-a");
  assert.equal(pricing.price(context, "latte", "coffee", "100000").finalPriceToman, "80000");
  assert.match(policyCalls[0]!.sql, /o\.coffee_shop_id=\$1/);
  assert.deepEqual(policyCalls[0]!.parameters, ["tenant-a", "client-a", ["promo"]]);

  offerRows = [{ promotionId: "promo", status: "ACTIVE", isMember: false }];
  context = await pricing.loadContext(manager as never, "tenant-a", new Date("2026-09-29T12:00:00Z"), "UTC", "client-b");
  assert.equal(pricing.price(context, "latte", "coffee", "100000").finalPriceToman, "100000");
  assert.equal(pricing.customerFailure(promotion as never, context, new Date()), "CUSTOMER_NOT_IN_CRM_OFFER_AUDIENCE");

  offerRows = [{ promotionId: "promo", status: "ACTIVE", isMember: true }];
  featureEnabled = false;
  context = await pricing.loadContext(manager as never, "tenant-a", new Date("2026-09-29T12:00:00Z"), "UTC", "client-a");
  assert.equal(pricing.price(context, "latte", "coffee", "100000").finalPriceToman, "100000");

  featureEnabled = true;
  offerRows = [{ promotionId: "promo", status: "ENDED", isMember: true }];
  context = await pricing.loadContext(manager as never, "tenant-a", new Date("2026-09-29T12:00:00Z"), "UTC", "client-a");
  assert.equal(pricing.price(context, "latte", "coffee", "100000").finalPriceToman, "100000");
});
