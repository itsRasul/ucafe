import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { DataSource, EntityManager } from "typeorm";
import dataSource from "../database/data-source";
import { CustomerSegmentsService } from "../clients/customer-segments.service";
import { OrderDeliveryMethod, OrderPaymentMethod, OrderStatus } from "../ordering/entities";
import { OrderingService } from "../ordering/ordering.service";
import { MenuService } from "../menu/menu.service";
import { AdvancedPromotionType, PromotionCustomerConditionOperator, PromotionCustomerConditionType, PromotionRewardType } from "./entities";
import { PromotionsService } from "./promotions.service";
import { PromotionWeekday } from "./promotion-schedule.util";

test("coupon quote, checkout, limit, cancellation and tenant isolation share authoritative prices", { skip: !process.env.PROMOTIONS_INTEGRATION_DATABASE_URL }, async () => {
  await dataSource.initialize();
  const rollback = new Error("rollback promotion fixture");
  try {
    await assert.rejects(dataSource.transaction(async (manager) => {
      const adapter = {
        manager, getRepository: manager.getRepository.bind(manager),
        query: manager.query.bind(manager),
        transaction: <T>(work: (m: EntityManager) => Promise<T>) => work(manager),
      } as unknown as DataSource;
      const tenants: [string, string] = [randomUUID(), randomUUID()];
      for (const id of tenants) await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Coupon Test',$2,'ACTIVE')`, [id, `coupon-${id}`]);
      const [actor] = await manager.query(`SELECT id FROM users LIMIT 1`);
      assert.ok(actor?.id);
      const [client] = await manager.query(`INSERT INTO clients(coffee_shop_id,first_name,last_name,phone) VALUES($1,'Coupon','Client','+989120000001') RETURNING id`, [tenants[0]]);
      const [nonMember] = await manager.query(`INSERT INTO clients(coffee_shop_id,first_name,last_name,phone) VALUES($1,'Other','Client','+989120000002') RETURNING id`, [tenants[0]]);
      const [foreignClient] = await manager.query(`INSERT INTO clients(coffee_shop_id,first_name,last_name,phone) VALUES($1,'Foreign','Client','+989120000003') RETURNING id`, [tenants[1]]);
      const [category] = await manager.query(`INSERT INTO menu_categories(coffee_shop_id,name) VALUES($1,'Coffee') RETURNING id`, [tenants[0]]);
      const [item] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Latte',1000000) RETURNING id`, [tenants[0], category.id]);
      const promotions = new PromotionsService(adapter);
      const latteSale = await promotions.create(tenants[0], actor.id, { name: "Latte sale", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 20, targets: [{ menuItemId: item.id }], entireOrder: false });
      assert.ok(latteSale);
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

      await promotions.setActive(tenants[0], latteSale.id, false);
      const segments = new CustomerSegmentsService(adapter);
      const vip = await segments.create(tenants[0], { name: "VIP" });
      await segments.addMember(tenants[0], vip.id, client.id, actor.id);
      assert.equal((await segments.list(tenants[0])).find((segment) => segment.id === vip.id)?.memberCount, 1);
      await manager.query("SAVEPOINT segment_tenant_scope");
      await assert.rejects(manager.query(`INSERT INTO customer_segment_memberships(coffee_shop_id,segment_id,client_id) VALUES($1,$2,$3)`, [tenants[1], vip.id, foreignClient.id]), (error: { code?: string }) => error.code === "23503");
      await manager.query("ROLLBACK TO SAVEPOINT segment_tenant_scope");
      await assert.rejects(segments.addMember(tenants[1], vip.id, foreignClient.id, actor.id));
      await assert.rejects(promotions.create(tenants[1], actor.id, { name: "Foreign segment", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 30, targets: [], entireOrder: true, customerConditions: [{ type: PromotionCustomerConditionType.CustomerSegment, customerSegmentId: vip.id }] }));
      await manager.query(`INSERT INTO orders(coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,subtotal_before_discount_toman,discount_total_toman,order_discount_toman,order_source,idempotency_key,status_changed_at) VALUES($1,$2,'DELIVERED','OFFLINE','PICKUP',10000000,10000000,0,0,'PUBLIC_CLIENT',$3,now()-interval '60 days')`, [tenants[1], foreignClient.id, randomUUID()]);
      await promotions.create(tenants[0], actor.id, { name: "Tenant spend guard", isActive: true, priority: 1, rewardType: PromotionRewardType.Percentage, rewardValue: 10, targets: [], entireOrder: true, customerConditions: [{ type: PromotionCustomerConditionType.TotalSpent, operator: PromotionCustomerConditionOperator.AtLeast, value: 5000000 }] });
      assert.equal((await ordering.quote(tenants[0], lines, undefined, foreignClient.id)).totalAmountToman, "1000000");
      await manager.query(`UPDATE orders SET status='DELIVERED', status_changed_at=now()-interval '40 days' WHERE id=$1`, [order.id]);
      const vipPromotion = await promotions.create(tenants[0], actor.id, { name: "VIP sale", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 30, targets: [], entireOrder: true, customerConditions: [
        { type: PromotionCustomerConditionType.CustomerSegment, customerSegmentId: vip.id },
        { type: PromotionCustomerConditionType.OrderCount, operator: PromotionCustomerConditionOperator.AtLeast, value: 1 },
        { type: PromotionCustomerConditionType.TotalSpent, operator: PromotionCustomerConditionOperator.AtLeast, value: 650000 },
        { type: PromotionCustomerConditionType.LastOrderAge, operator: PromotionCustomerConditionOperator.AtLeast, value: 30 },
      ] });
      assert.ok(vipPromotion);
      assert.equal((await ordering.quote(tenants[0], lines, undefined, client.id)).totalAmountToman, "700000");
      assert.equal((await ordering.quote(tenants[0], lines, undefined, nonMember.id)).totalAmountToman, "1000000");
      const vipOrder = await ordering.createOrder(tenants[0], client.id, { ...input, idempotencyKey: randomUUID(), couponCode: undefined });
      assert.equal(vipOrder.totalAmountToman, "700000");
      const [vipSnapshot] = await manager.query(`SELECT customer_promotion_snapshot FROM orders WHERE id=$1`, [vipOrder.id]);
      assert.equal(vipSnapshot.customer_promotion_snapshot[0].promotionId, vipPromotion.id);
      await segments.archive(tenants[0], vip.id);
      assert.equal((await ordering.quote(tenants[0], lines, undefined, client.id)).totalAmountToman, "1000000");
      assert.equal((await segments.list(tenants[0])).find((segment) => segment.id === vip.id)?.archived, true);

      await promotions.setActive(tenants[0], latteSale.id, true);
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

      const days: PromotionWeekday[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
      const today = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", weekday: "long" }).format(new Date()).toUpperCase() as PromotionWeekday;
      const todayIndex = days.indexOf(today);
      const unavailableDay = days[(todayIndex + 4) % days.length]!;
      const scheduledDays = days.filter((day) => day !== unavailableDay);
      await promotions.setActive(tenants[0], latteSale.id, false);
      const scheduledProduct = await promotions.create(tenants[0], actor.id, {
        name: "Scheduled Latte", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 40,
        targets: [{ categoryId: category.id }], entireOrder: false,
        schedule: { windows: [{ daysOfWeek: scheduledDays, isAllDay: true }] },
      });
      assert.ok(scheduledProduct);
      await manager.query("SAVEPOINT schedule_tenant_scope");
      await assert.rejects(manager.query(`INSERT INTO promotion_schedule_windows(coffee_shop_id,promotion_id,days_of_week,is_all_day) VALUES($1,$2,$3,true)`, [tenants[1], scheduledProduct.id, ["MONDAY"]]), (error: { code?: string }) => error.code === "23503");
      await manager.query("ROLLBACK TO SAVEPOINT schedule_tenant_scope");
      const scheduledCoupon = await promotions.create(tenants[0], actor.id, {
        name: "Scheduled coupon", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 10,
        targets: [], entireOrder: true, minimumSubtotalToman: 500000, couponCode: "HOUR10",
        schedule: { windows: [{ daysOfWeek: scheduledDays, isAllDay: true }] },
      });
      assert.ok(scheduledCoupon);
      await promotions.update(tenants[0], scheduledCoupon.id, { minimumSubtotalToman: 700000 });
      await assert.rejects(ordering.quote(tenants[0], lines, "HOUR10", client.id), (error: { response?: { code?: string } }) => error.response?.code === "MINIMUM_ORDER_NOT_MET");
      await promotions.update(tenants[0], scheduledCoupon.id, { minimumSubtotalToman: 500000 });
      const scheduledQuote = await ordering.quote(tenants[0], lines, "HOUR10", client.id);
      assert.equal(scheduledQuote.itemDiscountTotalToman, "400000");
      assert.equal(scheduledQuote.orderDiscountToman, "60000");
      assert.equal(scheduledQuote.totalAmountToman, "540000");
      const menu = new MenuService(adapter, { listMenuItemImages: async () => [] } as never);
      const activeMenu = await menu.getMenu(tenants[0], true, "Asia/Tehran");
      assert.equal(activeMenu.find((row) => row.id === category.id)?.items.find((row) => row.id === item.id)?.finalPriceToman, "600000");
      const scheduledOrder = await ordering.createOrder(tenants[0], client.id, { ...input, couponCode: "HOUR10", idempotencyKey: randomUUID() });
      await promotions.update(tenants[0], scheduledProduct.id, { schedule: { windows: [{ daysOfWeek: [unavailableDay], isAllDay: true }] } });
      await promotions.update(tenants[0], scheduledCoupon.id, { schedule: { windows: [{ daysOfWeek: [unavailableDay], isAllDay: true }] } });
      assert.equal((await ordering.quote(tenants[0], lines)).totalAmountToman, "1000000");
      const expiredMenu = await menu.getMenu(tenants[0], true, "Asia/Tehran");
      assert.equal(expiredMenu.find((row) => row.id === category.id)?.items.find((row) => row.id === item.id)?.finalPriceToman, "1000000");
      await assert.rejects(ordering.quote(tenants[0], lines, "HOUR10", client.id), (error: { response?: { code?: string } }) => error.response?.code === "PROMOTION_NOT_APPLICABLE");
      const [snapshot] = await manager.query(`SELECT o.total_amount_toman, i.promotion_name_snapshot FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.id=$1`, [scheduledOrder.id]);
      assert.equal(snapshot.total_amount_toman, "540000");
      assert.equal(snapshot.promotion_name_snapshot, "Scheduled Latte");

      await promotions.setActive(tenants[0], automatic.id, false);
      const advancedLines = [{ menuItemId: item.id, quantity: 6 }];
      const bogo = await promotions.create(tenants[0], actor.id, {
        name: "Buy 2 Get 1", isActive: true, priority: 10, rewardType: PromotionRewardType.Percentage, rewardValue: 100,
        entireOrder: false, targets: [], couponCode: "BOGO6", totalUsageLimit: 1,
        advancedRule: { type: AdvancedPromotionType.BuyXGetY, repeatable: true,
          buy: { quantity: 2, targets: [{ categoryId: category.id }] },
          get: { quantity: 1, targets: [{ menuItemId: item.id }] } },
      });
      assert.ok(bogo);
      assert.equal((await ordering.quote(tenants[0], advancedLines)).totalAmountToman, "6000000");
      const bogoQuote = await ordering.quote(tenants[0], advancedLines, "BOGO6", client.id);
      assert.equal(bogoQuote.totalAmountToman, "4000000");
      assert.equal(bogoQuote.itemDiscountTotalToman, "2000000");
      assert.equal(bogoQuote.couponCode, "BOGO6");
      assert.equal(bogoQuote.items.reduce((sum, line) => sum + line.quantity, 0), 6);
      assert.equal(bogoQuote.items.filter((line) => line.allocationType === "GET").reduce((sum, line) => sum + line.quantity, 0), 2);
      const bogoOrder = await ordering.createOrder(tenants[0], client.id, {
        items: advancedLines, paymentMethod: OrderPaymentMethod.Offline, deliveryMethod: OrderDeliveryMethod.Pickup,
        idempotencyKey: randomUUID(), couponCode: "BOGO6",
      });
      assert.equal(bogoOrder.totalAmountToman, bogoQuote.totalAmountToman);
      assert.equal(bogoOrder.items.reduce((sum, line) => sum + line.quantity, 0), 6);
      await assert.rejects(ordering.quote(tenants[0], advancedLines, "BOGO6", client.id), (error: { response?: { code?: string } }) => error.response?.code === "COUPON_USAGE_LIMIT_REACHED");
      const [bogoRedemption] = await manager.query(`SELECT discount_amount_toman FROM promotion_redemptions WHERE promotion_id=$1 AND order_id=$2`, [bogo.id, bogoOrder.id]);
      assert.equal(bogoRedemption.discount_amount_toman, "2000000");
      const [bogoSnapshot] = await manager.query(`SELECT i.promotion_type_snapshot, i.promotion_allocation_type_snapshot, i.promotion_rule_snapshot FROM order_items i WHERE i.order_id=$1 AND i.promotion_type_snapshot='BUY_X_GET_Y'`, [bogoOrder.id]);
      assert.equal(bogoSnapshot.promotion_allocation_type_snapshot, "GET");
      assert.match(bogoSnapshot.promotion_rule_snapshot, /2/);
      await promotions.archive(tenants[0], bogo.id);
      assert.equal((await ordering.clientDetail(tenants[0], client.id, bogoOrder.id)).totalAmountToman, "4000000");

      const crossTarget = await promotions.create(tenants[0], actor.id, {
        name: "Burger with dessert", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 50,
        entireOrder: false, targets: [], advancedRule: { type: AdvancedPromotionType.BuyXGetY, repeatable: false,
          buy: { quantity: 1, targets: [{ menuItemId: item.id }] }, get: { quantity: 1, targets: [{ menuItemId: cake.id }] } },
      });
      assert.ok(crossTarget);
      const crossQuote = await ordering.quote(tenants[0], [{ menuItemId: item.id, quantity: 1 }, { menuItemId: cake.id, quantity: 1 }]);
      assert.equal(crossQuote.totalAmountToman, "1050000");
      assert.equal(crossQuote.items.find((line) => line.menuItemId === cake.id)?.allocationType, "GET");
      await promotions.archive(tenants[0], crossTarget.id);

      const bundle = await promotions.create(tenants[0], actor.id, {
        name: "Latte and cake", isActive: true, priority: 0, rewardType: PromotionRewardType.FixedPrice, rewardValue: 1050000,
        entireOrder: false, targets: [], advancedRule: { type: AdvancedPromotionType.Bundle, repeatable: true, bundleComponents: [
          { quantity: 1, targets: [{ menuItemId: item.id }] }, { quantity: 1, targets: [{ menuItemId: cake.id }] },
        ] },
      });
      assert.ok(bundle);
      const bundleLines = [{ menuItemId: item.id, quantity: 1 }, { menuItemId: cake.id, quantity: 1 }];
      const bundleQuote = await ordering.quote(tenants[0], bundleLines);
      assert.equal(bundleQuote.totalAmountToman, "1050000");
      assert.equal(bundleQuote.items.reduce((sum, line) => sum + BigInt(line.discountAmountToman) * BigInt(line.quantity), BigInt(0)).toString(), "50000");
      const bundleOrder = await ordering.createOrder(tenants[0], client.id, { items: bundleLines, paymentMethod: OrderPaymentMethod.Offline, deliveryMethod: OrderDeliveryMethod.Pickup, idempotencyKey: randomUUID() });
      assert.equal(bundleOrder.totalAmountToman, bundleQuote.totalAmountToman);
      assert.equal(bundleOrder.items.reduce((sum, line) => sum + BigInt(line.lineTotalToman), BigInt(0)).toString(), "1050000");
      await promotions.archive(tenants[0], bundle.id);
      assert.equal((await ordering.clientDetail(tenants[0], client.id, bundleOrder.id)).totalAmountToman, "1050000");

      const quantity = await promotions.create(tenants[0], actor.id, {
        name: "Cold drink tiers", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 15,
        entireOrder: false, targets: [], advancedRule: { type: AdvancedPromotionType.QuantityTier, quantityTarget: { quantity: 1, targets: [{ categoryId: category.id }] },
          tiers: [{ minimumQuantity: 3, rewardType: PromotionRewardType.Percentage, rewardValue: 10 }, { minimumQuantity: 5, rewardType: PromotionRewardType.Percentage, rewardValue: 15 }] },
      });
      assert.ok(quantity);
      const quantityQuote = await ordering.quote(tenants[0], [{ menuItemId: item.id, quantity: 4 }]);
      assert.equal(quantityQuote.totalAmountToman, "3600000");
      assert.equal(quantityQuote.items.reduce((sum, line) => sum + line.quantity, 0), 4);
      const quantityOrder = await ordering.createOrder(tenants[0], client.id, { items: [{ menuItemId: item.id, quantity: 4 }], paymentMethod: OrderPaymentMethod.Offline, deliveryMethod: OrderDeliveryMethod.Pickup, idempotencyKey: randomUUID() });
      assert.equal(quantityOrder.totalAmountToman, quantityQuote.totalAmountToman);
      await promotions.archive(tenants[0], quantity.id);
      assert.equal((await ordering.clientDetail(tenants[0], client.id, quantityOrder.id)).totalAmountToman, "3600000");

      const [foreignCategory] = await manager.query(`INSERT INTO menu_categories(coffee_shop_id,name) VALUES($1,'Foreign') RETURNING id`, [tenants[1]]);
      const [foreignItem] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Foreign item',1000) RETURNING id`, [tenants[1], foreignCategory.id]);
      await assert.rejects(promotions.create(tenants[0], actor.id, {
        name: "Foreign target", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 10,
        entireOrder: false, targets: [], advancedRule: { type: AdvancedPromotionType.BuyXGetY, buy: { quantity: 1, targets: [{ menuItemId: foreignItem.id }] }, get: { quantity: 1, targets: [{ menuItemId: item.id }] } },
      }));
      const scoped = await promotions.create(tenants[0], actor.id, {
        name: "Scoped rule", isActive: true, priority: 0, rewardType: PromotionRewardType.Percentage, rewardValue: 10,
        entireOrder: false, targets: [], advancedRule: { type: AdvancedPromotionType.BuyXGetY, buy: { quantity: 1, targets: [{ menuItemId: item.id }] }, get: { quantity: 1, targets: [{ menuItemId: item.id }] } },
      });
      assert.ok(scoped);
      const [buyGroup] = await manager.query(`SELECT g.id FROM promotion_advanced_rules r JOIN promotion_rule_groups g ON g.coffee_shop_id=r.coffee_shop_id AND g.rule_id=r.id WHERE r.promotion_id=$1 AND g.role='BUY'`, [scoped.id]);
      await manager.query("SAVEPOINT advanced_tenant_scope");
      await assert.rejects(manager.query(`INSERT INTO promotion_rule_targets(coffee_shop_id,group_id,menu_item_id) VALUES($1,$2,$3)`, [tenants[0], buyGroup.id, foreignItem.id]));
      await manager.query("ROLLBACK TO SAVEPOINT advanced_tenant_scope");
      await promotions.archive(tenants[0], scoped.id);
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
    const checkout = (clientId: string, couponCode?: string) => ordering.createOrder(tenant, clientId, { items: [{ menuItemId: item.id, quantity: 1 }], paymentMethod: OrderPaymentMethod.Offline, deliveryMethod: OrderDeliveryMethod.Pickup, ...(couponCode ? { couponCode } : {}), idempotencyKey: randomUUID() });
    const totalRace = await Promise.allSettled([checkout(clients[0]!, "LASTONE"), checkout(clients[1]!, "LASTONE")]);
    assert.equal(totalRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(totalRace.filter((result) => result.status === "rejected").length, 1);
    const customerRace = await Promise.allSettled([checkout(clients[0]!, "ONEEACH"), checkout(clients[0]!, "ONEEACH")]);
    assert.equal(customerRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(customerRace.filter((result) => result.status === "rejected").length, 1);
    const [count] = await dataSource.query(`SELECT count(*)::int AS count FROM promotion_redemptions WHERE coffee_shop_id=$1 AND status='APPLIED'`, [tenant]);
    assert.equal(count.count, 2);

    await promotions.create(tenant, actor.id, { name: "First order automatic", isActive: true, priority: 1, rewardType: PromotionRewardType.Percentage, rewardValue: 10, targets: [], entireOrder: true, customerConditions: [{ type: PromotionCustomerConditionType.FirstOrder }] });
    const firstOrderRace = await Promise.allSettled([checkout(clients[0]!), checkout(clients[0]!)]);
    const firstOrderResults = firstOrderRace.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof checkout>>> => result.status === "fulfilled");
    assert.equal(firstOrderResults.length, 2);
    assert.deepEqual(firstOrderResults.map((result) => result.value.totalAmountToman).sort((a, b) => Number(a) - Number(b)), ["90000", "100000"]);
    const [firstOrderClaimCount] = await dataSource.query(`SELECT count(*)::int AS count FROM promotion_redemptions WHERE coffee_shop_id=$1 AND coupon_id IS NULL AND is_first_order_claim AND status='APPLIED'`, [tenant]);
    assert.equal(firstOrderClaimCount.count, 1);
    const discountedFirstOrder = firstOrderResults.find((result) => result.value.totalAmountToman === "90000")!.value;
    await ordering.updateStatus(tenant, discountedFirstOrder.id, actor.id, OrderStatus.Canceled);
    assert.equal((await ordering.quote(tenant, [{ menuItemId: item.id, quantity: 1 }], undefined, clients[0])).totalAmountToman, "90000");

    const firstOrderCoupon = await promotions.create(tenant, actor.id, { name: "First order code", isActive: true, priority: 2, rewardType: PromotionRewardType.Percentage, rewardValue: 20, targets: [], entireOrder: true, couponCode: "FIRSTONLY", customerConditions: [{ type: PromotionCustomerConditionType.FirstOrder }] });
    assert.ok(firstOrderCoupon);
    const firstCouponOrder = await checkout(clients[1]!, "FIRSTONLY");
    assert.equal(firstCouponOrder.totalAmountToman, "80000");
    await assert.rejects(ordering.quote(tenant, [{ menuItemId: item.id, quantity: 1 }], "FIRSTONLY", clients[1]), (error: { response?: { code?: string } }) => error.response?.code === "FIRST_ORDER_REQUIRED");
    await promotions.update(tenant, firstOrderCoupon.id, { customerConditions: [] });
    await ordering.updateStatus(tenant, firstCouponOrder.id, actor.id, OrderStatus.Canceled);
    assert.equal((await ordering.quote(tenant, [{ menuItemId: item.id, quantity: 1 }], "FIRSTONLY", clients[1])).totalAmountToman, "80000");
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
