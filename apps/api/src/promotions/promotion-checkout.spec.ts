import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { DataSource, EntityManager } from "typeorm";
import dataSource from "../database/data-source";
import { OrderDeliveryMethod, OrderPaymentMethod, OrderStatus } from "../ordering/entities";
import { OrderingService } from "../ordering/ordering.service";
import { PromotionRewardType } from "./entities";
import { PromotionsService } from "./promotions.service";

test("coupon quote, checkout, limit, cancellation and tenant isolation share authoritative prices", { skip: !process.env.PROMOTIONS_INTEGRATION_DATABASE_URL }, async () => {
  await dataSource.initialize();
  const rollback = new Error("rollback promotion fixture");
  try {
    await assert.rejects(dataSource.transaction(async (manager) => {
      const adapter = {
        manager, getRepository: manager.getRepository.bind(manager),
        transaction: <T>(work: (m: EntityManager) => Promise<T>) => work(manager),
      } as unknown as DataSource;
      const tenants: [string, string] = [randomUUID(), randomUUID()];
      for (const id of tenants) await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Coupon Test',$2,'ACTIVE')`, [id, `coupon-${id}`]);
      const [actor] = await manager.query(`SELECT id FROM users LIMIT 1`);
      assert.ok(actor?.id);
      const [client] = await manager.query(`INSERT INTO clients(coffee_shop_id,first_name,last_name,phone) VALUES($1,'Coupon','Client','+989120000001') RETURNING id`, [tenants[0]]);
      const [category] = await manager.query(`INSERT INTO menu_categories(coffee_shop_id,name) VALUES($1,'Coffee') RETURNING id`, [tenants[0]]);
      const [item] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Latte',1000000) RETURNING id`, [tenants[0], category.id]);
      const promotions = new PromotionsService(adapter);
      await promotions.create(tenants[0], actor.id, { name: "Latte sale", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 20, targets: [{ menuItemId: item.id }], entireOrder: false });
      const coupon = await promotions.create(tenants[0], actor.id, { name: "Welcome", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 30, targets: [], entireOrder: true, minimumSubtotalToman: 500000, maxDiscountToman: 150000, couponCode: "WELCOME20", totalUsageLimit: 1, perCustomerUsageLimit: 1 });
      assert.ok(coupon);
      await promotions.create(tenants[1], actor.id, { name: "Other", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 10, targets: [], entireOrder: true, couponCode: "WELCOME20" });
      await promotions.create(tenants[1], actor.id, { name: "Foreign only", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 10, targets: [], entireOrder: true, couponCode: "FOREIGN" });
      const ordering = new OrderingService(adapter, { requireFeature: async () => undefined } as never, { enqueue: async () => undefined, enqueueOwners: async () => undefined } as never, { reverseOrder: async () => undefined, consumeOrder: async () => undefined } as never);
      const lines = [{ menuItemId: item.id, quantity: 1 }];
      const quote = await ordering.quote(tenants[0], lines, " welcome20 ", client.id);
      assert.equal(quote.itemDiscountTotalToman, "200000");
      assert.equal(quote.orderDiscountToman, "150000");
      assert.equal(quote.totalAmountToman, "650000");
      assert.equal(quote.couponCode, "WELCOME20");
      await assert.rejects(ordering.quote(tenants[0], lines, "FOREIGN", client.id), (error: { response?: { code?: string } }) => error.response?.code === "COUPON_NOT_FOUND");
      await promotions.update(tenants[0], coupon.id, { minimumSubtotalToman: 800001 });
      await assert.rejects(ordering.quote(tenants[0], lines, "WELCOME20", client.id), (error: { response?: { code?: string } }) => error.response?.code === "MINIMUM_ORDER_NOT_MET");
      await promotions.update(tenants[0], coupon.id, { minimumSubtotalToman: 800000, couponActive: false });
      await assert.rejects(ordering.quote(tenants[0], lines, "WELCOME20", client.id), (error: { response?: { code?: string } }) => error.response?.code === "COUPON_INACTIVE");
      await promotions.update(tenants[0], coupon.id, { couponActive: true, couponStartsAt: new Date(Date.now() + 60000).toISOString() });
      await assert.rejects(ordering.quote(tenants[0], lines, "WELCOME20", client.id), (error: { response?: { code?: string } }) => error.response?.code === "COUPON_NOT_STARTED");
      await promotions.update(tenants[0], coupon.id, { couponStartsAt: null, couponExpiresAt: new Date(Date.now() - 60000).toISOString() });
      await assert.rejects(ordering.quote(tenants[0], lines, "WELCOME20", client.id), (error: { response?: { code?: string } }) => error.response?.code === "COUPON_EXPIRED");
      await promotions.update(tenants[0], coupon.id, { couponExpiresAt: null });
      assert.equal((await ordering.quote(tenants[0], lines, "WELCOME20", client.id)).totalAmountToman, "650000");
      await assert.rejects(ordering.quote(tenants[1], lines, "WELCOME20", client.id));
      const input = { items: lines, paymentMethod: OrderPaymentMethod.Offline, deliveryMethod: OrderDeliveryMethod.Pickup, idempotencyKey: randomUUID(), couponCode: "WELCOME20" };
      const order = await ordering.createOrder(tenants[0], client.id, input);
      assert.equal(order.totalAmountToman, quote.totalAmountToman);
      assert.equal(order.orderDiscountToman, quote.orderDiscountToman);
      assert.equal((await ordering.createOrder(tenants[0], client.id, input)).id, order.id);
      await assert.rejects(ordering.quote(tenants[0], lines, "WELCOME20", client.id), (error: { response?: { code?: string } }) => error.response?.code === "COUPON_USAGE_LIMIT_REACHED");
      await ordering.updateStatus(tenants[0], order.id, actor.id, OrderStatus.Canceled);
      assert.equal((await ordering.quote(tenants[0], lines, "WELCOME20", client.id)).totalAmountToman, "650000");
      const second = await ordering.createOrder(tenants[0], client.id, { ...input, idempotencyKey: randomUUID() });
      assert.equal(second.totalAmountToman, "650000");
      await ordering.updateStatus(tenants[0], second.id, actor.id, OrderStatus.Preparing);
      await ordering.updateStatus(tenants[0], second.id, actor.id, OrderStatus.Canceled);
      await assert.rejects(ordering.quote(tenants[0], lines, "WELCOME20", client.id), (error: { response?: { code?: string } }) => error.response?.code === "COUPON_USAGE_LIMIT_REACHED");
      const redemptions = await manager.query(`SELECT status::text FROM promotion_redemptions WHERE promotion_id=$1 ORDER BY created_at`, [coupon.id]);
      assert.deepEqual(redemptions.map((row: { status: string }) => row.status).sort(), ["APPLIED", "RELEASED"]);
      const automatic = await promotions.create(tenants[0], actor.id, { name: "Automatic order", isActive: true, priority: 0, rewardType: PromotionRewardType.FixedAmount, rewardValue: 900000, targets: [], entireOrder: true });
      assert.ok(automatic);
      assert.equal((await ordering.quote(tenants[0], lines)).totalAmountToman, "0");
      const [desserts] = await manager.query(`INSERT INTO menu_categories(coffee_shop_id,name) VALUES($1,'Desserts') RETURNING id`, [tenants[0]]);
      const [cake] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Cake',100000) RETURNING id`, [tenants[0], desserts.id]);
      await promotions.create(tenants[0], actor.id, { name: "Dessert coupon", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 20, targets: [{ categoryId: desserts.id }], entireOrder: false, couponCode: "DESSERT20" });
      await assert.rejects(ordering.quote(tenants[0], [...lines, { menuItemId: cake.id, quantity: 1 }], "DESSERT20", client.id), (error: { response?: { code?: string } }) => error.response?.code === "PROMOTION_NOT_APPLICABLE");
      await promotions.setActive(tenants[0], automatic.id, false);
      const targeted = await ordering.quote(tenants[0], [...lines, { menuItemId: cake.id, quantity: 1 }], "DESSERT20", client.id);
      assert.equal(targeted.itemDiscountTotalToman, "200000");
      assert.equal(targeted.orderDiscountToman, "20000");
      assert.equal(targeted.totalAmountToman, "880000");
      await promotions.create(tenants[0], actor.id, { name: "Small cap", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 30, targets: [], entireOrder: true, maxDiscountToman: 150000, couponCode: "SMALL30" });
      assert.equal((await ordering.quote(tenants[0], [{ menuItemId: cake.id, quantity: 1 }], "SMALL30", client.id)).orderDiscountToman, "30000");
      throw rollback;
    }), (error: Error) => error === rollback);
  } finally { await dataSource.destroy(); }
});

test("the last coupon use and a per-customer use cannot be spent twice", { skip: !process.env.PROMOTIONS_INTEGRATION_DATABASE_URL }, async () => {
  await dataSource.initialize();
  const tenant = randomUUID();
  try {
    const [actor] = await dataSource.query(`SELECT id FROM users LIMIT 1`);
    assert.ok(actor?.id);
    await dataSource.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Coupon Race',$2,'ACTIVE')`, [tenant, `coupon-race-${tenant}`]);
    const clients = [] as string[];
    for (const phone of ["+989120000001", "+989120000002"]) {
      const [row] = await dataSource.query(`INSERT INTO clients(coffee_shop_id,first_name,last_name,phone) VALUES($1,'Race','Client',$2) RETURNING id`, [tenant, phone]);
      clients.push(row.id);
    }
    const [category] = await dataSource.query(`INSERT INTO menu_categories(coffee_shop_id,name) VALUES($1,'Coffee') RETURNING id`, [tenant]);
    const [item] = await dataSource.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Latte',100000) RETURNING id`, [tenant, category.id]);
    const promotions = new PromotionsService(dataSource);
    await promotions.create(tenant, actor.id, { name: "One total", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 10, targets: [], entireOrder: true, couponCode: "LASTONE", totalUsageLimit: 1 });
    await promotions.create(tenant, actor.id, { name: "One per customer", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 10, targets: [], entireOrder: true, couponCode: "ONEEACH", perCustomerUsageLimit: 1 });
    const ordering = new OrderingService(dataSource, { requireFeature: async () => undefined } as never, { enqueue: async () => undefined, enqueueOwners: async () => undefined } as never, { reverseOrder: async () => undefined } as never);
    const checkout = (clientId: string, couponCode: string) => ordering.createOrder(tenant, clientId, { items: [{ menuItemId: item.id, quantity: 1 }], paymentMethod: OrderPaymentMethod.Offline, deliveryMethod: OrderDeliveryMethod.Pickup, couponCode, idempotencyKey: randomUUID() });
    const totalRace = await Promise.allSettled([checkout(clients[0]!, "LASTONE"), checkout(clients[1]!, "LASTONE")]);
    assert.equal(totalRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(totalRace.filter((result) => result.status === "rejected").length, 1);
    const customerRace = await Promise.allSettled([checkout(clients[0]!, "ONEEACH"), checkout(clients[0]!, "ONEEACH")]);
    assert.equal(customerRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(customerRace.filter((result) => result.status === "rejected").length, 1);
    const [count] = await dataSource.query(`SELECT count(*)::int AS count FROM promotion_redemptions WHERE coffee_shop_id=$1 AND status='APPLIED'`, [tenant]);
    assert.equal(count.count, 2);
  } finally {
    await dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM promotion_redemptions WHERE coffee_shop_id=$1`, [tenant]);
      await manager.query(`DELETE FROM order_items WHERE coffee_shop_id=$1`, [tenant]);
      await manager.query(`DELETE FROM orders WHERE coffee_shop_id=$1`, [tenant]);
      await manager.query(`DELETE FROM online_ordering_settings WHERE coffee_shop_id=$1`, [tenant]);
      await manager.query(`DELETE FROM promotion_targets WHERE coffee_shop_id=$1`, [tenant]);
      await manager.query(`DELETE FROM promotion_coupons WHERE coffee_shop_id=$1`, [tenant]);
      await manager.query(`DELETE FROM promotions WHERE coffee_shop_id=$1`, [tenant]);
      await manager.query(`DELETE FROM menu_items WHERE coffee_shop_id=$1`, [tenant]);
      await manager.query(`DELETE FROM menu_categories WHERE coffee_shop_id=$1`, [tenant]);
      await manager.query(`DELETE FROM clients WHERE coffee_shop_id=$1`, [tenant]);
      await manager.query(`DELETE FROM coffee_shops WHERE id=$1`, [tenant]);
    });
    await dataSource.destroy();
  }
});
