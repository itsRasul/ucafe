import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DataSource } from "typeorm";
import { ForbiddenException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AnalyticsQueryDto, compareMetric } from "./analytics.dto";
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

test("comparisons retain exact integers and null zero-base growth", () => {
  assert.equal(compareMetric(150n, 100n).changePercent, "50.00");
  assert.equal(compareMetric(50n, 100n).changePercent, "-50.00");
  assert.equal(compareMetric(100n, 100n).changePercent, "0.00");
  assert.equal(compareMetric(100n, 0n).changePercent, null);
});

test("analytics query rejects unknown periods and malformed dates", async () => {
  assert.ok((await validate(plainToInstance(AnalyticsQueryDto, { period: "tomorrow" }))).length > 0);
  assert.ok((await validate(plainToInstance(AnalyticsQueryDto, { period: "custom", start: "2026/01/01" }))).length > 0);
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
        `INSERT INTO orders(coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,idempotency_key,status_changed_at) VALUES($1,$2,$3::order_status,'OFFLINE','PICKUP',$4,$5,$6)`,
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
