import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DataSource } from "typeorm";
import { ForbiddenException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PromotionAnalyticsQueryDto } from "./analytics.dto";
import { PromotionAnalyticsService } from "./promotion-analytics.service";
import { OrdersQueryDto } from "../ordering/dto/ordering.dto";

test("promotion analytics requires the shared Analytics feature before querying", async () => {
  let queried = false;
  const service = new PromotionAnalyticsService(
    { query: async () => { queried = true; return []; } } as unknown as DataSource,
    { requireFeature: async () => { throw new ForbiddenException({ code: "FEATURE_UNAVAILABLE", feature: "analytics" }); } } as never,
  );
  await assert.rejects(service.overview("tenant-a", "UTC", { period: "today" } as PromotionAnalyticsQueryDto), ForbiddenException);
  await assert.rejects(service.detail("tenant-a", "UTC", randomUUID(), { period: "today" }), ForbiddenException);
  assert.equal(queried, false);
});

test("promotion analytics filters are bounded and use existing promotion enums", async () => {
  assert.equal((await validate(plainToInstance(PromotionAnalyticsQueryDto, { page: 0 }))).length > 0, true);
  assert.equal((await validate(plainToInstance(PromotionAnalyticsQueryDto, { pageSize: 101 }))).length > 0, true);
  assert.equal((await validate(plainToInstance(PromotionAnalyticsQueryDto, { activation: "SMS" }))).length > 0, true);
  assert.equal((await validate(plainToInstance(PromotionAnalyticsQueryDto, { promotionType: "BUNDLE" }))).length, 0);
  assert.equal((await validate(plainToInstance(OrdersQueryDto, { promotionId: randomUUID() }))).length, 0);
  assert.equal((await validate(plainToInstance(OrdersQueryDto, { promotionId: "bad" }))).length > 0, true);
});

test("SQL promotion reports reconcile stacked snapshots and isolate tenants", { skip: !process.env.ANALYTICS_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.ANALYTICS_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error("rollback promotion analytics fixtures");
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const tenantA = randomUUID(), tenantB = randomUUID(), clientA = randomUUID(), clientB = randomUUID();
      const productPromotion = randomUUID(), couponPromotion = randomUUID(), otherPromotion = randomUUID();
      const couponId = randomUUID(), delivered = randomUUID(), canceled = randomUUID(), pending = randomUUID(), releasedDelivered = randomUUID(), otherOrder = randomUUID();
      await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Promotion Analytics A',$2,'ACTIVE'),($3,'Promotion Analytics B',$4,'ACTIVE')`, [tenantA, `promotion-a-${tenantA}`, tenantB, `promotion-b-${tenantB}`]);
      await manager.query(`INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone) VALUES($1,$2,'Test','A',$3),($4,$5,'Test','B',$6)`, [clientA, tenantA, "+989100000011", clientB, tenantB, "+989100000012"]);
      await manager.query(`INSERT INTO promotions(id,coffee_shop_id,name,is_active,reward_type,reward_value) VALUES
        ($1,$2,'Latte Sale',true,'PERCENTAGE',20),($3,$2,'WELCOME',true,'PERCENTAGE',50),($4,$5,'Latte Sale',true,'PERCENTAGE',90)`, [productPromotion, tenantA, couponPromotion, otherPromotion, tenantB]);
      await manager.query(`INSERT INTO promotion_coupons(id,coffee_shop_id,promotion_id,code,normalized_code) VALUES($1,$2,$3,'WELCOME','WELCOME')`, [couponId, tenantA, couponPromotion]);
      const insertOrder = (id: string, tenant: string, client: string, status: string, total: string, discount: string, orderDiscount: string, orderPromotion: string | null, changed: string, code: string | null, customerSnapshot: string | null = null) => manager.query(`
        INSERT INTO orders(id,coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,
          subtotal_before_discount_toman,discount_total_toman,order_discount_toman,order_promotion_id_snapshot,
          order_promotion_name_snapshot,order_promotion_reward_type_snapshot,coupon_code_snapshot,customer_promotion_snapshot,
          idempotency_key,status_changed_at)
        VALUES($1,$2,$3,$4::order_status,'OFFLINE','PICKUP',$5,$6,$7,$8,$9,
          CASE WHEN $9::uuid IS NULL THEN NULL ELSE 'WELCOME' END,
          CASE WHEN $9::uuid IS NULL THEN NULL ELSE 'PERCENTAGE' END,$10,$11::jsonb,$12,$13)`,
      [id, tenant, client, status, total, String(Number(total) + Number(discount)), String(Number(discount)), orderDiscount, orderPromotion, code, customerSnapshot, randomUUID(), changed]);
      const insertItem = (orderId: string, tenant: string, promotionId: string, name: string, original: string, discount: string, quantity: number, category: string) => manager.query(`
        INSERT INTO order_items(coffee_shop_id,order_id,item_name,category_name_snapshot,unit_price_toman,
          original_unit_price_toman,discount_amount_toman,promotion_id_snapshot,promotion_name_snapshot,
          promotion_reward_type_snapshot,promotion_reward_value_snapshot,quantity,line_total_toman)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PERCENTAGE',20,$10,$11)`,
      [tenant, orderId, name, category, String(Number(original) - Number(discount)), original, discount, promotionId, name === "Latte" ? "Latte Sale" : "Other Sale", quantity, String((Number(original) - Number(discount)) * quantity)]);

      await insertOrder(delivered, tenantA, clientA, "DELIVERED", "30", "70", "50", couponPromotion, "2026-01-02T12:00:00Z", "WELCOME",
        JSON.stringify([{ promotionId: couponPromotion, promotionName: "WELCOME", conditions: [{ type: "FIRST_ORDER", operator: null, value: null }] }]));
      await insertItem(delivered, tenantA, productPromotion, "Latte", "100", "20", 1, "Coffee");
      await manager.query(`INSERT INTO promotion_redemptions(coffee_shop_id,promotion_id,coupon_id,customer_id,order_id,discount_amount_toman,status)
        VALUES($1,$2,$3,$4,$5,50,'APPLIED')`, [tenantA, couponPromotion, couponId, clientA, delivered]);

      await insertOrder(canceled, tenantA, clientA, "CANCELED", "80", "20", "20", couponPromotion, "2026-01-02T13:00:00Z", "WELCOME");
      await manager.query(`INSERT INTO promotion_redemptions(coffee_shop_id,promotion_id,coupon_id,customer_id,order_id,discount_amount_toman,status)
        VALUES($1,$2,$3,$4,$5,20,'RELEASED')`, [tenantA, couponPromotion, couponId, clientA, canceled]);
      await insertOrder(pending, tenantA, clientA, "UNDER_REVIEW", "30", "70", "50", couponPromotion, "2026-01-02T14:00:00Z", "WELCOME");
      await insertOrder(releasedDelivered, tenantA, clientA, "DELIVERED", "80", "20", "20", couponPromotion, "2026-01-02T15:00:00Z", "WELCOME");
      await manager.query(`INSERT INTO promotion_redemptions(coffee_shop_id,promotion_id,coupon_id,customer_id,order_id,discount_amount_toman,status)
        VALUES($1,$2,$3,$4,$5,20,'RELEASED')`, [tenantA, couponPromotion, couponId, clientA, releasedDelivered]);
      await insertOrder(otherOrder, tenantB, clientB, "DELIVERED", "10", "90", "0", null, "2026-01-02T12:00:00Z", null);
      await insertItem(otherOrder, tenantB, otherPromotion, "Other", "100", "90", 1, "Coffee");

      let pendingQuery = Promise.resolve();
      const service = new PromotionAnalyticsService(
        { query: (sql: string, values: unknown[]) => {
          const result = pendingQuery.then(() => manager.query(sql, values));
          pendingQuery = result.then(() => undefined, () => undefined);
          return result;
        } } as unknown as DataSource,
        { requireFeature: async () => undefined } as never,
      );
      const period = { period: "custom" as const, start: "2026-01-02", end: "2026-01-02" };
      const overview = await service.overview(tenantA, "UTC", { ...period, page: 1, pageSize: 20, sortBy: "uses" });
      assert.equal(overview.metrics.uses.value, "2");
      assert.equal(overview.metrics.ordersWithPromotion.value, "1");
      assert.equal(overview.metrics.uniqueCustomers.value, "1");
      assert.equal(overview.metrics.couponRedemptions.value, "1");
      assert.equal(overview.metrics.promotionDiscountToman.value, "70");
      assert.equal(overview.metrics.attributedOrderValueToman.value, "30");
      assert.equal(overview.currentTotals.grossPromotionalValueToman, "180");
      assert.equal(overview.currentTotals.netPromotionalValueToman, "110");
      assert.equal(overview.promotions.length, 2);

      const itemDetail = await service.detail(tenantA, "UTC", productPromotion, period);
      assert.equal(itemDetail.metrics.promotionDiscountToman.value, "20");
      assert.equal(itemDetail.metrics.ordersWithPromotion.value, "1");
      assert.equal(itemDetail.breakdowns.products[0]?.name, "Latte");
      assert.equal(itemDetail.breakdowns.products[0]?.discount, "20");
      assert.equal(itemDetail.breakdowns.categories[0]?.name, "Coffee");

      const couponDetail = await service.detail(tenantA, "UTC", couponPromotion, period);
      assert.equal(couponDetail.metrics.promotionDiscountToman.value, "50");
      assert.equal(couponDetail.coupons[0]?.couponCode, "WELCOME");
      assert.equal(couponDetail.coupons[0]?.uses, "1");
      assert.equal(couponDetail.coupons[0]?.averageOrderValue, "30");
      assert.equal(couponDetail.coupons[0]?.averageDiscount, "50");
      assert.deepEqual(couponDetail.customerConditions, [{ conditionType: "FIRST_ORDER", orders: "1", customers: "1" }]);
      assert.equal(couponDetail.usage.applicationCountAvailable, false);
      await assert.rejects(service.detail(tenantA, "UTC", otherPromotion, period));
      throw rollback;
    }), rollback);
  } finally {
    await db.destroy();
  }
});
