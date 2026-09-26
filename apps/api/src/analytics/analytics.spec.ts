import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DataSource } from "typeorm";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AnalyticsQueryDto, compareMetric, percentOf, ProductAnalyticsQueryDto, CustomerAnalyticsQueryDto } from "./analytics.dto";
import { analyticsGranularity, analyticsRanges } from "./analytics-period";
import { AnalyticsService } from "./analytics.service";

test("periods use cafe dates and adjacent comparison ranges", () => {
  const now = new Date("2026-01-01T20:45:00Z");
  const expected = [
    ["today", "2026-01-02", "2026-01-03", "2026-01-01"],
    ["yesterday", "2026-01-01", "2026-01-02", "2025-12-31"],
    ["last7Days", "2025-12-27", "2026-01-03", "2025-12-20"],
    ["last30Days", "2025-12-04", "2026-01-03", "2025-11-04"],
    ["currentMonth", "2026-01-01", "2026-02-01", "2025-12-01"],
    ["previousMonth", "2025-12-01", "2026-01-01", "2025-11-01"],
    ["currentYear", "2026-01-01", "2027-01-01", "2025-01-01"],
    ["previousYear", "2025-01-01", "2026-01-01", "2024-01-01"],
  ] as const;
  for (const [period, start, endExclusive, previousStart] of expected) {
    const ranges = analyticsRanges(period, "Asia/Tehran", undefined, undefined, now);
    assert.deepEqual(ranges.current, { start, endExclusive });
    assert.equal(ranges.previous.start, previousStart);
  }
  assert.equal(analyticsRanges("today", "UTC", undefined, undefined, now).current.start, "2026-01-01");
  assert.deepEqual(analyticsRanges("custom", "Asia/Tehran", "2026-01-10", "2026-01-19", now).previous, { start: "2025-12-31", endExclusive: "2026-01-10" });
  assert.throws(() => analyticsRanges("custom", "UTC", "2026-02-30", "2026-03-01"));
  assert.throws(() => analyticsRanges("custom", "UTC", "2026-02-02", "2026-02-01"));
  assert.throws(() => analyticsRanges("custom", "UTC", "2024-01-01", "2026-01-01"));
});

test("series granularity follows local period length", () => {
  assert.equal(analyticsGranularity({ start: "2026-01-02", endExclusive: "2026-01-03" }), "hour");
  assert.equal(analyticsGranularity({ start: "2026-01-01", endExclusive: "2026-01-31" }), "day");
  assert.equal(analyticsGranularity({ start: "2026-01-01", endExclusive: "2026-04-01" }), "week");
  assert.equal(analyticsGranularity({ start: "2026-01-01", endExclusive: "2027-01-01" }), "month");
});

test("direct overview access stops before SQL when analytics is not entitled", async () => {
  let queried = false;
  const service = new AnalyticsService({ query: async () => { queried = true; return []; } } as unknown as DataSource, { requireFeature: async () => { throw new ForbiddenException({ code: "FEATURE_UNAVAILABLE", feature: "analytics" }); } } as never);
  await assert.rejects(service.overview("tenant-a", "Asia/Tehran", { period: "today" }), (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { code: string }).code === "FEATURE_UNAVAILABLE");
  assert.equal(queried, false);
});

test("direct time access stops before SQL when analytics is not entitled", async () => {
  let queried = false;
  const service = new AnalyticsService({ query: async () => { queried = true; return []; } } as unknown as DataSource, { requireFeature: async () => { throw new ForbiddenException({ code: "FEATURE_UNAVAILABLE", feature: "analytics" }); } } as never);
  await assert.rejects(service.timeDistribution("tenant-a", "Asia/Tehran", { period: "today" }), ForbiddenException);
  assert.equal(queried, false);
});

test("time peaks return every tie and never promote empty buckets", async () => {
  const rows = [
    { date: "2026-01-02", hour: 3, revenue: "20", orders: "1" },
    { date: "2026-01-02", hour: 5, revenue: "20", orders: "1" },
  ];
  const service = new AnalyticsService({ query: async () => rows } as unknown as DataSource, { requireFeature: async () => undefined } as never);
  const result = await service.timeDistribution("tenant-a", "UTC", { period: "custom", start: "2026-01-02", end: "2026-01-02" });
  assert.deepEqual(result.peaks.revenueHours.map((hour) => hour.hour), [3, 5]);
  assert.deepEqual(result.peaks.orderHours.map((hour) => hour.hour), [3, 5]);
  assert.equal(result.peaks.revenueWeekdays[0]?.weekday, "friday");
});

test("comparisons retain exact integers and null zero-base growth", () => {
  assert.equal(compareMetric(150n, 100n).changePercent, "50.00");
  assert.equal(compareMetric(50n, 100n).changePercent, "-50.00");
  assert.equal(compareMetric(100n, 100n).changePercent, "0.00");
  assert.equal(compareMetric(100n, 0n).changePercent, null);
  assert.equal(percentOf(1n, 3n), "33.33");
  assert.equal(percentOf(0n, 0n), "0.00");
});

test("analytics query rejects unknown periods and malformed dates", async () => {
  assert.ok((await validate(plainToInstance(AnalyticsQueryDto, { period: "tomorrow" }))).length > 0);
  assert.ok((await validate(plainToInstance(AnalyticsQueryDto, { period: "custom", start: "2026/01/01" }))).length > 0);
  assert.ok((await validate(plainToInstance(ProductAnalyticsQueryDto, { limit: 21 }))).length > 0);
  assert.ok((await validate(plainToInstance(CustomerAnalyticsQueryDto, { limit: 21 }))).length > 0);
});

test("direct product analytics stops before SQL when analytics is not entitled", async () => {
  let queried = false;
  const service = new AnalyticsService({ query: async () => { queried = true; return []; } } as unknown as DataSource, { requireFeature: async () => { throw new ForbiddenException({ code: "FEATURE_UNAVAILABLE" }); } } as never);
  await assert.rejects(service.products("tenant-a", "UTC", { period: "today", limit: 10 }), ForbiddenException);
  await assert.rejects(service.product("tenant-a", "UTC", randomUUID(), { period: "today" }), ForbiddenException);
  assert.equal(queried, false);
});

test("direct customer analytics stops before SQL when analytics is not entitled", async () => {
  const service = new AnalyticsService({ query: async () => { throw new Error("SQL should not run"); } } as never, { requireFeature: async () => { throw new ForbiddenException(); } } as never);
  await assert.rejects(service.customers("tenant-a", "Asia/Tehran", { period: "today", limit: 10 }), ForbiddenException);
});

test("SQL overview excludes pending/cancelled revenue and isolates cafes", { skip: !process.env.ANALYTICS_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.ANALYTICS_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error("rollback analytics fixture");
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const tenantA = randomUUID(), tenantB = randomUUID(), clientA = randomUUID(), clientB = randomUUID();
      for (const id of [tenantA, tenantB]) await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Analytics Test',$2,'ACTIVE')`, [id, `analytics-${id}`]);
      await manager.query(`INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone) VALUES($1,$2,'Test','Client',$3),($4,$5,'Test','Client',$6)`, [clientA, tenantA, "+989100000001", clientB, tenantB, "+989100000002"]);
      const insert = (tenant: string, client: string, status: string, amount: string, changed = "2026-01-02T01:00:00Z") => manager.query(
        `INSERT INTO orders(coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,subtotal_before_discount_toman,discount_total_toman,order_discount_toman,idempotency_key,status_changed_at) VALUES($1,$2,$3::order_status,'OFFLINE','PICKUP',$4,$4,0,0,$5,$6)`,
        [tenant, client, status, amount, randomUUID(), changed],
      );
      await insert(tenantA, clientA, "DELIVERED", "50", "2026-01-01T20:29:59Z");
      await insert(tenantA, clientA, "DELIVERED", "1", "2026-01-01T20:30:00Z");
      await insert(tenantA, clientA, "DELIVERED", "101");
      await insert(tenantA, clientA, "DELIVERED", "200");
      await insert(tenantA, clientA, "CANCELED", "900");
      await insert(tenantA, clientA, "UNDER_REVIEW", "900");
      await insert(tenantB, clientB, "DELIVERED", "9999");
      const entitled: string[] = [];
      const service = new AnalyticsService({ query: (sql: string, parameters: unknown[]) => manager.query(sql, parameters) } as DataSource, { requireFeature: async (tenant: string) => { entitled.push(tenant); } } as never);
      const query = { period: "custom" as const, start: "2026-01-02", end: "2026-01-02" };
      const a = await service.overview(tenantA, "Asia/Tehran", query);
      assert.equal(a.metrics.revenueToman.value, "302");
      assert.equal(a.metrics.completedOrders.value, "3");
      assert.equal(a.metrics.cancelledOrders.value, "1");
      assert.equal(a.metrics.uniqueCustomers.value, "1");
      assert.equal(a.metrics.averageOrderValueToman.value, "101");
      assert.equal(a.metrics.revenueToman.previousValue, "50");
      assert.equal(a.metrics.revenueToman.changePercent, "504.00");
      assert.equal(a.granularity, "hour");
      assert.equal(a.series.revenueToman.points.length, 24);
      assert.equal(a.series.revenueToman.points.reduce((sum, point) => sum + BigInt(point.value), 0n), 302n);
      assert.equal(a.series.completedOrders.points.reduce((sum, point) => sum + BigInt(point.value), 0n), 3n);
      assert.equal(a.series.revenueToman.points.filter((point) => point.value === "0").length, 22);
      assert.equal(a.series.revenueToman.points[0]?.value, "1");
      const time = await service.timeDistribution(tenantA, "Asia/Tehran", query);
      assert.equal(time.hours.length, 24);
      assert.equal(time.weekdays.length, 7);
      assert.equal(time.heatmap.length, 168);
      assert.equal(time.dates.length, 1);
      assert.equal(time.hours[0]?.revenue, "1");
      assert.equal(time.hours[4]?.revenue, "301");
      assert.equal(time.hours[1]?.completedOrders, "0");
      assert.equal(time.weekdays[6]?.weekday, "friday");
      assert.equal(time.weekdays[6]?.revenue, "302");
      assert.equal(time.heatmap[6 * 24 + 4]?.completedOrders, "2");
      assert.equal(time.peaks.revenueHours[0]?.hour, 4);
      assert.equal(time.peaks.orderHours[0]?.hour, 4);
      assert.equal(time.peaks.revenueDates[0]?.date, "2026-01-02");
      assert.equal(time.peaks.lowestActiveRevenueDates[0]?.date, "2026-01-02");
      const utcTime = await service.timeDistribution(tenantA, "UTC", query);
      assert.equal(utcTime.hours[1]?.revenue, "301");
      assert.equal(utcTime.dates[0]?.revenue, "301");
      const otherTime = await service.timeDistribution(tenantB, "Asia/Tehran", query);
      assert.equal(otherTime.dates[0]?.revenue, "9999");
      assert.equal(otherTime.hours[4]?.revenue, "9999");
      const spanning = await service.timeDistribution(tenantA, "Asia/Tehran", { period: "custom", start: "2026-01-01", end: "2026-01-03" });
      assert.deepEqual(spanning.dates.map((day) => day.revenue), ["50", "302", "0"]);
      assert.equal(spanning.weekdays[5]?.revenue, "50");
      assert.equal(spanning.weekdays[6]?.revenue, "302");
      assert.equal(spanning.peaks.lowestActiveRevenueDates[0]?.date, "2026-01-01");
      const emptyTime = await service.timeDistribution(tenantA, "Asia/Tehran", { period: "custom", start: "2026-01-03", end: "2026-01-03" });
      assert.equal(emptyTime.dates[0]?.revenue, "0");
      assert.equal(emptyTime.peaks.revenueHours.length, 0);
      assert.equal(emptyTime.heatmap.every((cell) => cell.completedOrders === "0"), true);
      const b = await service.overview(tenantB, "Asia/Tehran", query);
      assert.equal(b.metrics.revenueToman.value, "9999");
      assert.ok(entitled.includes(tenantA) && entitled.includes(tenantB));
      const empty = await service.overview(tenantA, "Asia/Tehran", { period: "custom", start: "2026-01-03", end: "2026-01-03" });
      assert.equal(empty.metrics.revenueToman.value, "0");
      assert.equal(empty.metrics.revenueToman.previousValue, "302");
      assert.equal(empty.metrics.revenueToman.changePercent, "-100.00");
      assert.equal(empty.metrics.averageOrderValueToman.value, "0");
      const week = await service.overview(tenantA, "Asia/Tehran", { period: "custom", start: "2025-12-27", end: "2026-01-02" });
      assert.equal(week.granularity, "day");
      assert.equal(week.series.revenueToman.points.length, 7);
      assert.equal(week.series.revenueToman.points.at(-1)?.value, "302");
      assert.equal(week.series.revenueToman.points.reduce((sum, point) => sum + BigInt(point.value), 0n), 352n);
      const quarter = await service.overview(tenantA, "Asia/Tehran", { period: "custom", start: "2025-10-01", end: "2026-01-02" });
      assert.equal(quarter.granularity, "week");
      assert.ok(quarter.series.revenueToman.points.some((point) => point.value === "0"));
      const year = await service.overview(tenantA, "Asia/Tehran", { period: "custom", start: "2025-02-01", end: "2026-01-02" });
      assert.equal(year.granularity, "month");
      assert.equal(year.series.revenueToman.points.length, 12);
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.destroy(); }
});

test("SQL product analytics uses item/category snapshots, quantities, comparison periods, and tenant scope", { skip: !process.env.ANALYTICS_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.ANALYTICS_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error("rollback product analytics fixture");
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const tenantA = randomUUID(), tenantB = randomUUID(), clientA = randomUUID(), clientB = randomUUID();
      for (const id of [tenantA, tenantB]) await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Product Analytics Test',$2,'ACTIVE')`, [id, `product-analytics-${id}`]);
      await manager.query(`INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone) VALUES($1,$2,'Test','Client',$3),($4,$5,'Test','Client',$6)`, [clientA, tenantA, "+989110000001", clientB, tenantB, "+989110000002"]);
      const coffeeA = randomUUID(), foodA = randomUUID(), coffeeB = randomUUID();
      await manager.query(`INSERT INTO menu_categories(id,coffee_shop_id,name,is_active) VALUES($1,$2,'قهوه',true),($3,$2,'غذا',true),($4,$5,'قهوه دیگر',true)`, [coffeeA, tenantA, foodA, coffeeB, tenantB]);
      const latte = randomUUID(), sandwich = randomUUID(), zeroSale = randomUUID(), foreign = randomUUID();
      await manager.query(`INSERT INTO menu_items(id,coffee_shop_id,category_id,name,base_price_toman,is_available) VALUES($1,$2,$3,'لاته',100,true),($4,$2,$5,'ساندویچ',200,true),($6,$2,$5,'بدون فروش',50,true),($7,$8,$9,'محصول خارجی',999,true)`, [latte, tenantA, coffeeA, sandwich, foodA, zeroSale, foreign, tenantB, coffeeB]);
      const order = async (tenant: string, client: string, status: string, total: string, changed: string) => (await manager.query(
         `INSERT INTO orders(coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,subtotal_before_discount_toman,discount_total_toman,order_discount_toman,idempotency_key,status_changed_at) VALUES($1,$2,$3::order_status,'OFFLINE','PICKUP',$4,$4,0,0,$5,$6) RETURNING id`,
        [tenant, client, status, total, randomUUID(), changed],
      ))[0].id as string;
      const item = (tenant: string, orderId: string, productId: string, name: string, categoryId: string, categoryName: string, price: string, quantity: number) => manager.query(
        `INSERT INTO order_items(coffee_shop_id,order_id,menu_item_id,item_name,category_id_snapshot,category_name_snapshot,unit_price_toman,original_unit_price_toman,discount_amount_toman,quantity,line_total_toman) VALUES($1,$2,$3,$4,$5,$6,$7,$7,0,$8,$9)`,
        [tenant, orderId, productId, name, categoryId, categoryName, price, quantity, (BigInt(price) * BigInt(quantity)).toString()],
      );
      await item(tenantA, await order(tenantA, clientA, "DELIVERED", "300", "2026-01-02T01:00:00Z"), latte, "لاته", coffeeA, "قهوه", "100", 3);
      await item(tenantA, await order(tenantA, clientA, "DELIVERED", "200", "2026-01-02T02:00:00Z"), sandwich, "ساندویچ", foodA, "غذا", "200", 1);
      await item(tenantA, await order(tenantA, clientA, "DELIVERED", "80", "2026-01-01T01:00:00Z"), latte, "لاته قدیم", coffeeA, "قهوه", "80", 1);
      await item(tenantA, await order(tenantA, clientA, "CANCELED", "900", "2026-01-02T03:00:00Z"), latte, "لاته", coffeeA, "قهوه", "300", 3);
      await item(tenantB, await order(tenantB, clientB, "DELIVERED", "999", "2026-01-02T01:00:00Z"), foreign, "محصول خارجی", coffeeB, "قهوه دیگر", "999", 1);
      await manager.query(`UPDATE menu_items SET name='لاته جدید', category_id=$2, deleted_at=now() WHERE id=$1`, [latte, foodA]);

      const service = new AnalyticsService({ query: (sql: string, parameters: unknown[]) => manager.query(sql, parameters) } as DataSource, { requireFeature: async () => undefined } as never);
      const query = { period: "custom" as const, start: "2026-01-02", end: "2026-01-02", limit: 1 };
      const report = await service.products(tenantA, "Asia/Tehran", query);
      assert.equal(report.totals.productRevenueToman, "500");
      assert.equal(report.totals.quantitySold, "4");
      assert.equal(report.rankings.byRevenue[0]?.name, "لاته جدید");
      assert.equal(report.rankings.byRevenue[0]?.status, "archived");
      assert.equal(report.rankings.byRevenue[0]?.quantitySold.value, "3");
      assert.equal(report.rankings.byRevenue[0]?.ordersContainingProduct.value, "1");
      assert.equal(report.rankings.byRevenue[0]?.revenueToman.previousValue, "80");
      assert.equal(report.contribution[0]?.revenueToman.value, "300");
      assert.equal(report.contribution[1]?.name, "سایر محصولات");
      assert.equal(report.contribution[1]?.revenueToman.value, "200");
      assert.equal(report.categories.find((category) => category.name === "قهوه")?.revenueToman.value, "300");
      assert.equal(report.categories.find((category) => category.name === "غذا")?.revenueToman.value, "200");
      assert.equal(report.summary.activeProductsWithoutSales, "1");
      assert.equal(report.zeroSaleProducts[0]?.productId, zeroSale);
      assert.ok(report.categoryTrends.every((point) => point.name !== "قهوه دیگر"));

      const detail = await service.product(tenantA, "Asia/Tehran", latte, query);
      assert.equal(detail.product.status, "archived");
      assert.equal(detail.metrics.revenueToman.value, "300");
      assert.equal(detail.metrics.quantitySold.value, "3");
      assert.equal(detail.metrics.ordersContainingProduct.value, "1");
      assert.equal(detail.metrics.averageSellingPriceToman, "100");
      assert.equal(detail.metrics.revenueSharePercent, "60.00");
      assert.equal(detail.series.quantitySold.points.reduce((sum, point) => sum + BigInt(point.value), 0n), 3n);
      await assert.rejects(service.product(tenantA, "Asia/Tehran", foreign, query), NotFoundException);
      const other = await service.products(tenantB, "Asia/Tehran", query);
      assert.equal(other.rankings.byRevenue[0]?.name, "محصول خارجی");
      assert.equal(other.totals.productRevenueToman, "999");
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.destroy(); }
});

test("SQL customer analytics uses tenant-local identity, first-purchase classification, trends and bounded rankings", { skip: !process.env.ANALYTICS_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.ANALYTICS_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error("rollback customer analytics fixture");
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const tenantA = randomUUID(), tenantB = randomUUID();
      const clientA = randomUUID(), clientB = randomUUID(), clientC = randomUUID(), clientD = randomUUID(), clientForeign = randomUUID();
      for (const id of [tenantA, tenantB]) await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Customer Analytics Test',$2,'ACTIVE')`, [id, `customer-analytics-${id}`]);
      await manager.query(`INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone) VALUES
        ($1,$6,'A','Returning','+989120000001'),($2,$6,'B','New','+989120000002'),($3,$6,'C','Returning','+989120000003'),
        ($4,$6,'D','New','+989120000004'),($5,$7,'Foreign','Customer','+989120000005')`, [clientA, clientB, clientC, clientD, clientForeign, tenantA, tenantB]);
      const addOrder = (tenant: string, client: string, status: string, amount: string, at: string) => manager.query(
        `INSERT INTO orders(coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,subtotal_before_discount_toman,discount_total_toman,order_discount_toman,idempotency_key,status_changed_at)
         VALUES($1,$2,$3::order_status,'OFFLINE','PICKUP',$4,$4,0,0,$5,$6)`, [tenant, client, status, amount, randomUUID(), at],
      );
      await addOrder(tenantA, clientA, "DELIVERED", "50", "2026-01-08T01:00:00Z");
      await addOrder(tenantA, clientA, "DELIVERED", "100", "2026-01-10T00:00:00Z");
      await addOrder(tenantA, clientA, "DELIVERED", "300", "2026-01-10T03:10:00Z");
      await addOrder(tenantA, clientB, "DELIVERED", "100", "2026-01-10T03:15:00Z");
      await addOrder(tenantA, clientB, "DELIVERED", "100", "2026-01-10T03:45:00Z");
      await addOrder(tenantA, clientB, "DELIVERED", "100", "2026-01-10T04:15:00Z");
      await addOrder(tenantA, clientC, "DELIVERED", "120", "2026-01-09T01:00:00Z");
      await addOrder(tenantA, clientC, "DELIVERED", "50", "2026-01-10T02:10:00Z");
      await addOrder(tenantA, clientD, "CANCELED", "900", "2026-01-09T02:00:00Z");
      await addOrder(tenantA, clientD, "DELIVERED", "75", "2026-01-10T01:30:00Z");
      await addOrder(tenantB, clientForeign, "DELIVERED", "99999", "2026-01-10T03:00:00Z");
      await manager.query(`UPDATE clients SET first_name='Renamed', phone='+989120000009' WHERE id=$1`, [clientA]);

      const service = new AnalyticsService({ query: (sql: string, parameters: unknown[]) => manager.query(sql, parameters) } as DataSource, { requireFeature: async () => undefined } as never);
      const report = await service.customers(tenantA, "UTC", { period: "custom", start: "2026-01-10", end: "2026-01-10", limit: 10 });
      assert.equal(report.metrics.uniqueCustomers.value, "4");
      assert.equal(report.metrics.newCustomers.value, "2");
      assert.equal(report.metrics.returningCustomers.value, "2");
      assert.equal(report.metrics.returningCustomerRate.value, "50.00");
      assert.equal(report.metrics.returningCustomerRate.previousValue, "0.00");
      assert.equal(report.metrics.returningCustomerRate.changePercent, null);
      assert.equal(report.metrics.knownCustomerRevenueToman.value, "825");
      assert.equal(report.metrics.averageRevenuePerCustomerToman.value, "206");
      assert.equal(report.metrics.averageOrdersPerCustomer.value, "1.75");
      assert.equal(report.newVsReturning[0]?.revenueToman, "375");
      assert.equal(report.newVsReturning[1]?.revenueToman, "450");
      assert.equal(report.coverage.identifiedOrderPercent, "100.00");
      assert.deepEqual(report.behavior.orderCountDistribution.map((item) => item.customers), ["1", "3", "0", "0", "0"]);
      assert.equal(report.behavior.averageDaysBetweenOrders, "0.6");
      assert.equal(report.behavior.topTenRevenueSharePercent, "100.00");
      assert.equal(report.rankings.byRevenue[0]?.customerId, clientA);
      assert.equal(report.rankings.byOrderCount[0]?.customerId, clientB);
      assert.equal(report.rankings.byRevenue[0]?.displayName, "Renamed Returning");
      assert.doesNotMatch(JSON.stringify(report), /\+989120000009/);
      assert.equal(report.rankings.byOrderCount.length, 4);
      assert.equal(report.rankings.byRevenue.some((customer) => customer.customerId === clientForeign), false);
      assert.equal(report.rankings.byRevenue[0]?.lifetimeOrderCount, "3");
      assert.equal(report.trends.uniqueCustomers.points.length, 24);
      assert.equal(report.trends.uniqueCustomers.points.find((point) => point.bucket === "2026-01-10T00:00:00Z")?.value, "1");
      assert.equal(report.trends.uniqueCustomers.points.find((point) => point.bucket === "2026-01-10T03:00:00Z")?.value, "2");
      assert.equal(report.trends.newCustomers.points.find((point) => point.bucket === "2026-01-10T03:00:00Z")?.value, "1");
      assert.equal(report.trends.returningCustomers.points.find((point) => point.bucket === "2026-01-10T04:00:00Z")?.value, "1");
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.destroy(); }
});

test("direct order analytics access stops before SQL when analytics is not entitled", async () => {
  let queried = false;
  const service = new AnalyticsService({ query: async () => { queried = true; return []; } } as unknown as DataSource, { requireFeature: async () => { throw new ForbiddenException({ code: "FEATURE_UNAVAILABLE" }); } } as never);
  await assert.rejects(service.orders("tenant-a", "UTC", { period: "today" }), ForbiddenException);
  assert.equal(queried, false);
});

test("SQL order analytics separates created orders, terminal outcomes, delivery and sources without multiplying revenue", { skip: !process.env.ANALYTICS_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.ANALYTICS_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error("rollback order analytics fixture");
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const tenantA = randomUUID(), tenantB = randomUUID(), clientA = randomUUID(), clientB = randomUUID();
      for (const id of [tenantA, tenantB]) await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Order Analytics Test',$2,'ACTIVE')`, [id, `order-analytics-${id}`]);
      await manager.query(`INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone) VALUES($1,$2,'Test','A','+989130000001'),($3,$4,'Test','B','+989130000002')`, [clientA, tenantA, clientB, tenantB]);
      const addOrder = async (tenant: string, client: string, status: string, delivery: string, source: string | null, total: string, created: string, changed: string | null) => {
        const rows = await manager.query(
          `INSERT INTO orders(coffee_shop_id,client_id,status,payment_method,delivery_method,order_source,total_amount_toman,subtotal_before_discount_toman,discount_total_toman,order_discount_toman,idempotency_key,created_at,status_changed_at)
           VALUES($1,$2,$3::order_status,'OFFLINE',$4::order_delivery_method,$5::order_source,$6,$6,0,0,$7,$8,$9) RETURNING id`,
          [tenant, client, status, delivery, source, total, randomUUID(), created, changed],
        );
        return rows[0].id as string;
      };
      const addItem = (tenant: string, orderId: string, unit: string, quantity: number) => manager.query(
        `INSERT INTO order_items(coffee_shop_id,order_id,item_name,unit_price_toman,original_unit_price_toman,discount_amount_toman,quantity,line_total_toman) VALUES($1,$2,'Test item',$3,$3,0,$4,$5)`,
        [tenant, orderId, unit, quantity, (BigInt(unit) * BigInt(quantity)).toString()],
      );
      const publicSource = "PUBLIC_CLIENT";
      const first = await addOrder(tenantA, clientA, "DELIVERED", "PICKUP", publicSource, "500", "2026-01-02T04:00:00Z", "2026-01-02T04:30:00Z");
      await addItem(tenantA, first, "200", 1);
      await addItem(tenantA, first, "150", 2);
      const second = await addOrder(tenantA, clientA, "DELIVERED", "COURIER", publicSource, "300", "2026-01-02T05:00:00Z", "2026-01-02T05:30:00Z");
      await addItem(tenantA, second, "150", 2);
      const canceled = await addOrder(tenantA, clientA, "CANCELED", "PICKUP", publicSource, "100", "2026-01-02T06:00:00Z", "2026-01-02T06:30:00Z");
      await addItem(tenantA, canceled, "100", 1);
      await addOrder(tenantA, clientA, "UNDER_REVIEW", "PICKUP", publicSource, "50", "2026-01-02T07:00:00Z", null);
      const createdEarlier = await addOrder(tenantA, clientA, "DELIVERED", "PICKUP", publicSource, "150", "2026-01-01T22:00:00Z", "2026-01-02T08:00:00Z");
      await addItem(tenantA, createdEarlier, "150", 1);
      const oldUnknown = await addOrder(tenantA, clientA, "DELIVERED", "PICKUP", null, "200", "2026-01-01T02:00:00Z", "2026-01-01T02:30:00Z");
      await addItem(tenantA, oldUnknown, "200", 1);
      const foreign = await addOrder(tenantB, clientB, "DELIVERED", "COURIER", publicSource, "9000", "2026-01-02T04:00:00Z", "2026-01-02T04:30:00Z");
      await addItem(tenantB, foreign, "9000", 1);

      const service = new AnalyticsService({ query: (sql: string, parameters: unknown[]) => manager.query(sql, parameters) } as DataSource, { requireFeature: async () => undefined } as never);
      const query = { period: "custom" as const, start: "2026-01-02", end: "2026-01-02" };
      const report = await service.orders(tenantA, "UTC", query);
      assert.equal(report.metrics.totalOrdersCreated.value, "4");
      assert.equal(report.metrics.completedOrders.value, "3");
      assert.equal(report.metrics.cancelledOrders.value, "1");
      assert.equal(report.metrics.completionRate.value, "75.00");
      assert.equal(report.metrics.cancellationRate.value, "25.00");
      assert.equal(report.metrics.cancelledOrderValueToman.value, "100");
      assert.equal(report.metrics.averageItemsPerOrder.value, "2.00");
      assert.equal(report.metrics.averageItemsPerOrder.previousValue, "1.00");
      assert.equal(report.statusBreakdown.find((row) => row.status === "UNDER_REVIEW")?.orderCount, "1");
      assert.equal(report.statusBreakdown.find((row) => row.status === "DELIVERED")?.orderCount, "2");
      assert.equal(report.statusBreakdown.some((row) => String(row.status) === "REJECTED"), false);
      assert.equal(report.outcomeTrend.find((series) => series.key === "DELIVERED")?.points.reduce((sum, point) => sum + BigInt(point.value), 0n), 3n);
      assert.equal(report.outcomeTrend.find((series) => series.key === "CANCELED")?.points.reduce((sum, point) => sum + BigInt(point.value), 0n), 1n);
      assert.equal(report.fulfillment.find((row) => row.fulfillmentType === "PICKUP")?.revenueToman.value, "650");
      assert.equal(report.fulfillment.find((row) => row.fulfillmentType === "PICKUP")?.totalOrders.value, "3");
      assert.equal(report.fulfillment.find((row) => row.fulfillmentType === "PICKUP")?.orderSharePercent, "75.00");
      assert.equal(report.fulfillment.find((row) => row.fulfillmentType === "PICKUP")?.completedOrders.value, "2");
      assert.equal(report.fulfillment.find((row) => row.fulfillmentType === "PICKUP")?.completedOrderSharePercent, "66.66");
      assert.equal(report.fulfillment.find((row) => row.fulfillmentType === "COURIER")?.revenueToman.value, "300");
      assert.equal(report.fulfillment.find((row) => row.fulfillmentType === "PICKUP")?.averageOrderValueToman.value, "325");
      assert.equal(report.sources.find((row) => row.source === "PUBLIC_CLIENT")?.revenueToman.value, "950");
      assert.equal(report.sources.find((row) => row.source === "PUBLIC_CLIENT")?.totalOrders.value, "4");
      assert.equal(report.sources[0]?.source, "PUBLIC_CLIENT");
      assert.equal(report.sources.find((row) => row.source === "UNKNOWN")?.revenueToman.previousValue, "200");
      assert.equal(report.orderSizeDistribution.find((row) => row.key === "threeToFour")?.orders, "1");
      assert.equal(report.orderSizeDistribution.find((row) => row.key === "two")?.orders, "1");
      assert.equal(report.orderSizeDistribution.find((row) => row.key === "one")?.orders, "1");
      assert.equal(report.fulfillment.reduce((sum, row) => sum + BigInt(row.revenueToman.value ?? "0"), 0n), 950n);
      const other = await service.orders(tenantB, "UTC", query);
      assert.equal(other.metrics.completedOrders.value, "1");
      assert.equal(other.fulfillment.find((row) => row.fulfillmentType === "COURIER")?.revenueToman.value, "9000");
      await addOrder(tenantA, clientA, "UNDER_REVIEW", "PICKUP", publicSource, "40", "2026-01-03T01:00:00Z", null);
      const activeOnly = await service.orders(tenantA, "UTC", { period: "custom", start: "2026-01-03", end: "2026-01-03" });
      assert.equal(activeOnly.metrics.totalOrdersCreated.value, "1");
      assert.equal(activeOnly.metrics.completedOrders.value, "0");
      assert.equal(activeOnly.metrics.completionRate.value, null);
      assert.equal(activeOnly.metrics.cancellationRate.value, null);
      assert.equal(activeOnly.fulfillment[0]?.completedOrders.value, "0");
      assert.equal(activeOnly.outcomeTrend.every((series) => series.points.every((point) => point.value === "0")), true);
      const empty = await service.orders(tenantA, "UTC", { period: "custom", start: "2026-01-04", end: "2026-01-04" });
      assert.equal(empty.metrics.totalOrdersCreated.value, "0");
      assert.equal(empty.metrics.averageItemsPerOrder.value, "0.00");
      assert.equal(empty.sources.find((row) => row.source === "PUBLIC_CLIENT")?.totalOrders.value, "0");
      assert.equal(empty.sources.find((row) => row.source === "PUBLIC_CLIENT")?.totalOrders.previousValue, "1");
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.destroy(); }
});

test("reservation analytics requires both Analytics and Reservations before querying", async () => {
  for (const disabled of ["analytics", "reservations"]) {
    const calls: string[] = [];
    const service = new AnalyticsService(
      { query: async () => { throw new Error("SQL should not run"); } } as unknown as DataSource,
      { requireFeature: async (_tenant: string, feature: string) => { calls.push(feature); if (feature === disabled) throw new ForbiddenException({ code: "FEATURE_UNAVAILABLE", feature }); } } as never,
    );
    await assert.rejects(service.reservations("tenant-a", "UTC", { period: "today" }), ForbiddenException);
    assert.deepEqual(calls, disabled === "analytics" ? ["analytics"] : ["analytics", "reservations"]);
  }
});

test("reservation SQL separates created, scheduled, and terminal event time and stays tenant-scoped", { skip: !process.env.ANALYTICS_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.ANALYTICS_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error("rollback reservation analytics fixture");
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const tenantA = randomUUID(), tenantB = randomUUID(), branchA = randomUUID(), branchB = randomUUID();
      const clientA = randomUUID(), clientB = randomUUID();
      await manager.query(
        "INSERT INTO coffee_shops(id,name,slug,status,timezone) VALUES($1,'Reservation Analytics',$2,'ACTIVE','Asia/Tehran'),($3,'Reservation Analytics',$4,'ACTIVE','Asia/Tehran')",
        [tenantA, "reservation-analytics-" + tenantA, tenantB, "reservation-analytics-" + tenantB],
      );
      await manager.query(
        "INSERT INTO branches(id,coffee_shop_id,name,slug,is_primary,timezone) VALUES($1,$2,'Main','main',true,'Asia/Tehran'),($3,$4,'Main','main',true,'Asia/Tehran')",
        [branchA, tenantA, branchB, tenantB],
      );
      await manager.query(
        "INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone) VALUES($1,$2,'Test','A','+989140000001'),($3,$4,'Test','B','+989140000002')",
        [clientA, tenantA, clientB, tenantB],
      );
      const addReservation = (tenant: string, branch: string, client: string, status: string, date: string, time: string, party: number, created: string, changed: string | null) => manager.query(
        "INSERT INTO reservations(coffee_shop_id,branch_id,client_id,contact_name,reservation_date,start_time,end_time,party_size,status,created_at,status_changed_at) VALUES($1,$2,$3,'Test', $4::date,$5::time,($5::time + interval '90 minutes'),$6,$7::reservation_status,$8,$9)",
        [tenant, branch, client, date, time, party, status, created, changed],
      );
      await addReservation(tenantA, branchA, clientA, "PENDING", "2026-01-09", "19:00", 2, "2026-01-05T06:30:00Z", null);
      await addReservation(tenantA, branchA, clientA, "PENDING", "2026-01-09", "17:00", 7, "2026-01-04T20:45:00Z", null);
      await addReservation(tenantA, branchA, clientA, "CONFIRMED", "2026-01-09", "20:00", 4, "2026-01-08T22:30:00Z", "2026-01-08T22:30:00Z");
      await addReservation(tenantA, branchA, clientA, "REJECTED", "2026-01-09", "19:00", 5, "2026-01-05T08:30:00Z", "2026-01-07T08:30:00Z");
      await addReservation(tenantA, branchA, clientA, "CANCELED", "2026-01-09", "21:00", 6, "2026-01-05T09:30:00Z", "2026-01-08T14:30:00Z");
      await addReservation(tenantA, branchA, clientA, "COMPLETED", "2026-01-09", "18:00", 1, "2026-01-07T08:30:00Z", "2026-01-09T15:30:00Z");
      await addReservation(tenantA, branchA, clientA, "NO_SHOW", "2026-01-09", "20:00", 3, "2026-01-07T10:30:00Z", "2026-01-09T17:30:00Z");
      await addReservation(tenantB, branchB, clientB, "CONFIRMED", "2026-01-09", "20:00", 50, "2026-01-09T18:00:00Z", "2026-01-09T18:00:00Z");

      const service = new AnalyticsService(
        { query: (sql: string, parameters: unknown[]) => manager.query(sql, parameters) } as unknown as DataSource,
        { requireFeature: async () => undefined } as never,
      );
      const query = { period: "custom" as const, start: "2026-01-05", end: "2026-01-09" };
      const report = await service.reservations(tenantA, "Asia/Tehran", query);
      assert.equal(report.metrics.createdReservations.value, "7");
      assert.equal(report.metrics.scheduledReservations.value, "7");
      assert.equal(report.metrics.reservedGuests.value, "17");
      assert.equal(report.metrics.averagePartySize.value, "3.40");
      assert.equal(report.metrics.largestPartySize.value, "7");
      assert.equal(report.metrics.confirmationRate.value, "50.00");
      assert.equal(report.metrics.completionRate.value, "25.00");
      assert.equal(report.metrics.cancellationRate.value, "25.00");
      assert.equal(report.metrics.rejectionRate.value, "25.00");
      assert.equal(report.metrics.noShowRate.value, "50.00");
      assert.equal(report.metrics.averageBookingLeadTimeHours.value, "78.7");
      assert.equal(report.metrics.averageCancellationLeadTimeHours.value, "27.0");
      assert.equal(report.statusBreakdown.find((row) => row.status === "PENDING")?.reservationCount, "2");
      assert.equal(report.statusBreakdown.find((row) => row.status === "NO_SHOW")?.reservationCount, "1");
      assert.equal(report.trends.createdReservations.points.find((point) => point.bucket === "2026-01-05")?.value, "4");
      assert.equal(report.trends.createdReservations.points.reduce((sum, point) => sum + BigInt(point.value), 0n), 7n);
      assert.equal(report.trends.scheduledReservations.points.find((point) => point.bucket === "2026-01-09")?.value, "7");
      assert.equal(report.trends.reservedGuests.points.find((point) => point.bucket === "2026-01-09")?.value, "17");
      assert.equal(report.trends.cancellationTrend.points.reduce((sum, point) => sum + BigInt(point.value), 0n), 1n);
      assert.equal(report.trends.rejectionTrend.points.reduce((sum, point) => sum + BigInt(point.value), 0n), 1n);
      assert.equal(report.trends.noShowTrend.points.reduce((sum, point) => sum + BigInt(point.value), 0n), 1n);
      assert.equal(report.distribution.weekdays.length, 7);
      assert.equal(report.distribution.hours.length, 24);
      assert.equal(report.distribution.heatmap.length, 168);
      assert.equal(report.distribution.heatmap.find((cell) => cell.weekday === "friday" && cell.hour === 20)?.reservedGuests, "7");
      assert.equal(report.distribution.dates.length, 5);
      assert.deepEqual(report.peaks.reservationHours.map((row) => row.hour), [19, 20]);
      assert.deepEqual(report.peaks.guestHours.map((row) => row.hour), [17, 20]);
      assert.deepEqual(report.distribution.partySizes.map((row) => row.partySize), [1, 2, 3, 4, 7]);

      const foreign = await service.reservations(tenantB, "Asia/Tehran", query);
      assert.equal(foreign.metrics.scheduledReservations.value, "1");
      assert.equal(foreign.metrics.reservedGuests.value, "50");
      assert.equal(foreign.metrics.completionRate.value, null);
      assert.equal(foreign.metrics.noShowRate.value, null);
      assert.equal(foreign.metrics.averageBookingLeadTimeHours.value, null);
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.destroy(); }
});
