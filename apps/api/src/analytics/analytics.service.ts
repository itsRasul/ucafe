import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CANCELLED_ORDER_STATUS, COMPLETED_ORDER_STATUS } from "../ordering/order-status.util";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { AnalyticsQueryDto, compareMetric, percentOf, ProductAnalyticsQueryDto } from "./analytics.dto";
import { analyticsGranularity, analyticsRanges, AnalyticsGranularity, AnalyticsRanges } from "./analytics-period";

interface AggregateRow {
  period: "current" | "previous";
  revenue: string;
  completedOrders: string;
  cancelledOrders: string;
  uniqueCustomers: string;
}
interface SeriesRow { bucket: string; revenue: string; orders: string }
interface TimeRow { date: string; hour: number; revenue: string; orders: string }
interface ProductRow {
  key: string; productId: string | null; name: string; status: "active" | "unavailable" | "archived" | "deleted";
  currentRevenue: string; currentQuantity: string; currentOrders: string;
  previousRevenue: string; previousQuantity: string; previousOrders: string;
}
interface CategoryRow {
  key: string; categoryId: string | null; name: string;
  currentRevenue: string; currentQuantity: string; currentOrders: string;
  previousRevenue: string; previousQuantity: string; previousOrders: string;
}
interface ZeroSaleRow { productId: string; name: string; categoryName: string; total: string }
export interface ProductInfoRow { productId: string; name: string; status: "active" | "unavailable" | "archived" }
interface ProductDetailRow {
  currentRevenue: string; currentQuantity: string; currentOrders: string; totalRevenue: string;
  previousRevenue: string; previousQuantity: string; previousOrders: string;
}
interface ItemSeriesRow { bucket: string; revenue: string; quantity: string; orders: string }
export interface CategorySeriesRow extends ItemSeriesRow { key: string; categoryId: string | null; name: string }
type TimeBucket = { revenue: string; completedOrders: string };
const WEEKDAYS = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"] as const;
const emptyBucket = (): TimeBucket => ({ revenue: "0", completedOrders: "0" });
const add = (bucket: TimeBucket, row: TimeRow) => {
  bucket.revenue = (BigInt(bucket.revenue) + BigInt(row.revenue)).toString();
  bucket.completedOrders = (BigInt(bucket.completedOrders) + BigInt(row.orders)).toString();
};
const peak = <T extends TimeBucket>(buckets: T[], metric: keyof TimeBucket): T[] => {
  const max = buckets.reduce((value, bucket) => BigInt(bucket[metric]) > value ? BigInt(bucket[metric]) : value, 0n);
  return max === 0n ? [] : buckets.filter((bucket) => BigInt(bucket[metric]) === max);
};
const compareBigInt = (left: bigint, right: bigint) => left < right ? -1 : left > right ? 1 : 0;

const EMPTY: Omit<AggregateRow, "period"> = { revenue: "0", completedOrders: "0", cancelledOrders: "0", uniqueCustomers: "0" };

@Injectable()
export class AnalyticsService {
  constructor(private readonly dataSource: DataSource, private readonly subscriptions: SubscriptionsService) {}

  private ranges(timezone: string, query: AnalyticsQueryDto) {
    if (query.period === "custom" ? !query.start || !query.end : query.start !== undefined || query.end !== undefined) {
      throw new BadRequestException("Start and end are allowed only together for a custom period");
    }
    return analyticsRanges(query.period, timezone, query.start, query.end);
  }

  async overview(coffeeShopId: string, timezone: string, query: AnalyticsQueryDto) {
    await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.Analytics);
    const ranges = this.ranges(timezone, query);
    const granularity = analyticsGranularity(ranges.current);
    const [rows, points] = await Promise.all([this.dataSource.query<AggregateRow[]>(`
      WITH bounds AS (
        SELECT $2::timestamp AT TIME ZONE $5 AS previous_start,
               $3::timestamp AT TIME ZONE $5 AS current_start,
               $4::timestamp AT TIME ZONE $5 AS current_end
      )
      SELECT CASE WHEN o.status_changed_at < b.current_start THEN 'previous' ELSE 'current' END AS period,
             COALESCE(SUM(o.total_amount_toman) FILTER (WHERE o.status = $6::order_status), 0)::text AS revenue,
             COUNT(*) FILTER (WHERE o.status = $6::order_status)::text AS "completedOrders",
             COUNT(*) FILTER (WHERE o.status = $7::order_status)::text AS "cancelledOrders",
             COUNT(DISTINCT o.client_id) FILTER (WHERE o.status = $6::order_status)::text AS "uniqueCustomers"
      FROM orders o CROSS JOIN bounds b
      WHERE o.coffee_shop_id = $1 AND o.status IN ($6::order_status, $7::order_status)
        AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_end
      GROUP BY 1
    `, [coffeeShopId, ranges.previous.start, ranges.current.start, ranges.current.endExclusive, timezone, COMPLETED_ORDER_STATUS, CANCELLED_ORDER_STATUS]), this.series(coffeeShopId, ranges, granularity)]);
    const current = rows.find((row) => row.period === "current") ?? EMPTY;
    const previous = rows.find((row) => row.period === "previous") ?? EMPTY;
    const average = (row: typeof EMPTY) => {
      const count = BigInt(row.completedOrders);
      return count === 0n ? 0n : (BigInt(row.revenue) + count / 2n) / count;
    };
    return {
      period: query.period,
      timezone,
      current: ranges.current,
      previous: ranges.previous,
      granularity,
      metrics: {
        revenueToman: compareMetric(BigInt(current.revenue), BigInt(previous.revenue)),
        completedOrders: compareMetric(BigInt(current.completedOrders), BigInt(previous.completedOrders)),
        cancelledOrders: compareMetric(BigInt(current.cancelledOrders), BigInt(previous.cancelledOrders)),
        uniqueCustomers: compareMetric(BigInt(current.uniqueCustomers), BigInt(previous.uniqueCustomers)),
        averageOrderValueToman: compareMetric(average(current), average(previous)),
      },
      series: {
        revenueToman: { key: "revenueToman", label: "فروش", points: points.map((point) => ({ bucket: point.bucket, label: point.bucket, value: point.revenue })) },
        completedOrders: { key: "completedOrders", label: "سفارش‌های تکمیل‌شده", points: points.map((point) => ({ bucket: point.bucket, label: point.bucket, value: point.orders })) },
        averageOrderValueToman: { key: "averageOrderValueToman", label: "میانگین هر سفارش", points: points.map((point) => ({ bucket: point.bucket, label: point.bucket, value: average({ ...EMPTY, revenue: point.revenue, completedOrders: point.orders }).toString() })) },
      },
    };
  }

  async timeDistribution(coffeeShopId: string, timezone: string, query: AnalyticsQueryDto) {
    await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.Analytics);
    const { current } = this.ranges(timezone, query);
    const rows = await this.dataSource.query<TimeRow[]>(`
      WITH bounds AS (
        SELECT $2::timestamp AT TIME ZONE $5 AS start_at,
               $3::timestamp AT TIME ZONE $5 AS end_at
      )
      SELECT to_char(o.status_changed_at AT TIME ZONE $5, 'YYYY-MM-DD') AS date,
             EXTRACT(HOUR FROM o.status_changed_at AT TIME ZONE $5)::int AS hour,
             SUM(o.total_amount_toman)::text AS revenue, COUNT(*)::text AS orders
      FROM orders o CROSS JOIN bounds b
      WHERE o.coffee_shop_id = $1 AND o.status = $4::order_status
        AND o.status_changed_at >= b.start_at AND o.status_changed_at < b.end_at
      GROUP BY 1, 2 ORDER BY 1, 2
    `, [coffeeShopId, current.start, current.endExclusive, COMPLETED_ORDER_STATUS, timezone]);
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, ...emptyBucket() }));
    const weekdays = WEEKDAYS.map((weekday) => ({ weekday, ...emptyBucket() }));
    const heatmap = WEEKDAYS.flatMap((weekday) => hours.map(({ hour }) => ({ weekday, hour, ...emptyBucket() })));
    const dates: Array<{ date: string } & TimeBucket> = [];
    const daily = new Map<string, (typeof dates)[number]>();
    for (let timestamp = Date.parse(`${current.start}T00:00:00Z`); timestamp < Date.parse(`${current.endExclusive}T00:00:00Z`); timestamp += 86400000) {
      const date = new Date(timestamp).toISOString().slice(0, 10);
      const bucket = { date, ...emptyBucket() };
      dates.push(bucket);
      daily.set(date, bucket);
    }
    for (const row of rows) {
      const weekdayIndex = (new Date(`${row.date}T00:00:00Z`).getUTCDay() + 1) % 7;
      add(hours[row.hour]!, row);
      add(weekdays[weekdayIndex]!, row);
      add(heatmap[weekdayIndex * 24 + row.hour]!, row);
      add(daily.get(row.date)!, row);
    }
    const activeDates = dates.filter((date) => BigInt(date.completedOrders) > 0n);
    const lowestRevenue = activeDates.reduce<bigint | null>((lowest, date) => lowest === null || BigInt(date.revenue) < lowest ? BigInt(date.revenue) : lowest, null);
    return {
      period: query.period, timezone, current, hours, weekdays, heatmap, dates,
      peaks: {
        revenueHours: peak(hours, "revenue"), orderHours: peak(hours, "completedOrders"),
        revenueWeekdays: peak(weekdays, "revenue"), orderWeekdays: peak(weekdays, "completedOrders"),
        revenueDates: peak(dates, "revenue"), orderDates: peak(dates, "completedOrders"),
        lowestActiveRevenueDates: lowestRevenue === null ? [] : activeDates.filter((date) => BigInt(date.revenue) === lowestRevenue),
      },
    };
  }

  async products(coffeeShopId: string, timezone: string, query: ProductAnalyticsQueryDto) {
    await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.Analytics);
    const ranges = this.ranges(timezone, query);
    const params = [coffeeShopId, ranges.previous.start, ranges.current.start, ranges.current.endExclusive, timezone, COMPLETED_ORDER_STATUS];
    const [productRows, categoryRows, zeroSaleRows] = await Promise.all([
      this.dataSource.query<ProductRow[]>(`
        WITH bounds AS (
          SELECT $2::timestamp AT TIME ZONE $5 AS previous_start,
                 $3::timestamp AT TIME ZONE $5 AS current_start,
                 $4::timestamp AT TIME ZONE $5 AS current_end
        )
        SELECT COALESCE(oi.menu_item_id::text, 'snapshot:' || md5(oi.item_name)) AS key,
               oi.menu_item_id AS "productId",
               COALESCE(mi.name, (array_agg(oi.item_name ORDER BY o.status_changed_at DESC))[1]) AS name,
               CASE WHEN oi.menu_item_id IS NULL OR mi.id IS NULL THEN 'deleted'
                    WHEN mi.deleted_at IS NOT NULL THEN 'archived'
                    WHEN NOT mi.is_available THEN 'unavailable' ELSE 'active' END AS status,
               COALESCE(SUM(oi.line_total_toman) FILTER (WHERE o.status_changed_at >= b.current_start), 0)::text AS "currentRevenue",
               COALESCE(SUM(oi.quantity) FILTER (WHERE o.status_changed_at >= b.current_start), 0)::text AS "currentQuantity",
               COUNT(DISTINCT oi.order_id) FILTER (WHERE o.status_changed_at >= b.current_start)::text AS "currentOrders",
               COALESCE(SUM(oi.line_total_toman) FILTER (WHERE o.status_changed_at < b.current_start), 0)::text AS "previousRevenue",
               COALESCE(SUM(oi.quantity) FILTER (WHERE o.status_changed_at < b.current_start), 0)::text AS "previousQuantity",
               COUNT(DISTINCT oi.order_id) FILTER (WHERE o.status_changed_at < b.current_start)::text AS "previousOrders"
        FROM orders o JOIN order_items oi ON oi.order_id = o.id AND oi.coffee_shop_id = o.coffee_shop_id
        CROSS JOIN bounds b
        LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id AND mi.coffee_shop_id = o.coffee_shop_id
        WHERE o.coffee_shop_id = $1 AND o.status = $6::order_status
          AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_end
        GROUP BY 1, oi.menu_item_id, mi.id, mi.name, mi.deleted_at, mi.is_available
      `, params),
      this.dataSource.query<CategoryRow[]>(`
        WITH bounds AS (
          SELECT $2::timestamp AT TIME ZONE $5 AS previous_start,
                 $3::timestamp AT TIME ZONE $5 AS current_start,
                 $4::timestamp AT TIME ZONE $5 AS current_end
        )
        SELECT COALESCE(oi.category_id_snapshot::text, 'uncategorized') AS key,
               oi.category_id_snapshot AS "categoryId",
               COALESCE((array_agg(oi.category_name_snapshot ORDER BY o.status_changed_at DESC) FILTER (WHERE oi.category_name_snapshot IS NOT NULL))[1], 'بدون دسته‌بندی') AS name,
               COALESCE(SUM(oi.line_total_toman) FILTER (WHERE o.status_changed_at >= b.current_start), 0)::text AS "currentRevenue",
               COALESCE(SUM(oi.quantity) FILTER (WHERE o.status_changed_at >= b.current_start), 0)::text AS "currentQuantity",
               COUNT(DISTINCT oi.order_id) FILTER (WHERE o.status_changed_at >= b.current_start)::text AS "currentOrders",
               COALESCE(SUM(oi.line_total_toman) FILTER (WHERE o.status_changed_at < b.current_start), 0)::text AS "previousRevenue",
               COALESCE(SUM(oi.quantity) FILTER (WHERE o.status_changed_at < b.current_start), 0)::text AS "previousQuantity",
               COUNT(DISTINCT oi.order_id) FILTER (WHERE o.status_changed_at < b.current_start)::text AS "previousOrders"
        FROM orders o JOIN order_items oi ON oi.order_id = o.id AND oi.coffee_shop_id = o.coffee_shop_id
        CROSS JOIN bounds b
        WHERE o.coffee_shop_id = $1 AND o.status = $6::order_status
          AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_end
        GROUP BY oi.category_id_snapshot
      `, params),
      this.dataSource.query<ZeroSaleRow[]>(`
        WITH bounds AS (SELECT $2::timestamp AT TIME ZONE $5 AS start_at, $3::timestamp AT TIME ZONE $5 AS end_at)
        SELECT mi.id AS "productId", mi.name, mc.name AS "categoryName", COUNT(*) OVER()::text AS total
        FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id AND mc.coffee_shop_id = mi.coffee_shop_id
        CROSS JOIN bounds b
        WHERE mi.coffee_shop_id = $1 AND mi.deleted_at IS NULL AND mi.is_available
          AND mc.deleted_at IS NULL AND mc.is_active
          AND NOT EXISTS (
            SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.coffee_shop_id = oi.coffee_shop_id
            WHERE oi.coffee_shop_id = mi.coffee_shop_id AND oi.menu_item_id = mi.id AND o.status = $4::order_status
              AND o.status_changed_at >= b.start_at AND o.status_changed_at < b.end_at
          )
        ORDER BY mc.sort_order, mi.sort_order, mi.name LIMIT $6
      `, [coffeeShopId, ranges.current.start, ranges.current.endExclusive, COMPLETED_ORDER_STATUS, timezone, query.limit]),
    ]);

    const productRevenue = productRows.reduce((sum, row) => sum + BigInt(row.currentRevenue), 0n);
    const productQuantity = productRows.reduce((sum, row) => sum + BigInt(row.currentQuantity), 0n);
    const product = (row: ProductRow) => ({
      key: row.key, productId: row.productId, name: row.name, status: row.status,
      revenueToman: compareMetric(BigInt(row.currentRevenue), BigInt(row.previousRevenue)),
      quantitySold: compareMetric(BigInt(row.currentQuantity), BigInt(row.previousQuantity)),
      ordersContainingProduct: compareMetric(BigInt(row.currentOrders), BigInt(row.previousOrders)),
      revenueSharePercent: percentOf(BigInt(row.currentRevenue), productRevenue),
      quantitySharePercent: percentOf(BigInt(row.currentQuantity), productQuantity),
    });
    const sold = productRows.filter((row) => BigInt(row.currentQuantity) > 0n);
    const byRevenue = [...sold].sort((a, b) => compareBigInt(BigInt(b.currentRevenue), BigInt(a.currentRevenue)) || a.name.localeCompare(b.name, "fa"));
    const byQuantity = [...sold].sort((a, b) => compareBigInt(BigInt(b.currentQuantity), BigInt(a.currentQuantity)) || compareBigInt(BigInt(b.currentRevenue), BigInt(a.currentRevenue)) || a.name.localeCompare(b.name, "fa"));
    const lowPerforming = [...sold].sort((a, b) => compareBigInt(BigInt(a.currentQuantity), BigInt(b.currentQuantity)) || compareBigInt(BigInt(a.currentRevenue), BigInt(b.currentRevenue)) || a.name.localeCompare(b.name, "fa"));
    const growing = productRows.filter((row) => BigInt(row.currentRevenue) > BigInt(row.previousRevenue)).sort((a, b) => compareBigInt(BigInt(b.currentRevenue) - BigInt(b.previousRevenue), BigInt(a.currentRevenue) - BigInt(a.previousRevenue)));
    const declining = productRows.filter((row) => BigInt(row.currentRevenue) < BigInt(row.previousRevenue)).sort((a, b) => compareBigInt(BigInt(a.currentRevenue) - BigInt(a.previousRevenue), BigInt(b.currentRevenue) - BigInt(b.previousRevenue)));
    const categories = categoryRows.filter((row) => BigInt(row.currentQuantity) > 0n).map((row) => ({
      key: row.key, categoryId: row.categoryId, name: row.name,
      revenueToman: compareMetric(BigInt(row.currentRevenue), BigInt(row.previousRevenue)),
      quantitySold: compareMetric(BigInt(row.currentQuantity), BigInt(row.previousQuantity)),
      ordersContainingCategory: compareMetric(BigInt(row.currentOrders), BigInt(row.previousOrders)),
      revenueSharePercent: percentOf(BigInt(row.currentRevenue), productRevenue),
      quantitySharePercent: percentOf(BigInt(row.currentQuantity), productQuantity),
    })).sort((a, b) => compareBigInt(BigInt(b.revenueToman.value), BigInt(a.revenueToman.value)));
    const contributionTop = byRevenue.slice(0, Math.min(5, query.limit));
    const contributionRevenue = contributionTop.reduce((sum, row) => sum + BigInt(row.currentRevenue), 0n);
    const categoryTrends = await this.categorySeries(coffeeShopId, ranges, analyticsGranularity(ranges.current), Math.min(5, query.limit));
    return {
      period: query.period, timezone, current: ranges.current, previous: ranges.previous, granularity: analyticsGranularity(ranges.current),
      summary: {
        distinctProductsSold: sold.length.toString(), topRevenueProduct: byRevenue[0] ? product(byRevenue[0]) : null,
        topQuantityProduct: byQuantity[0] ? product(byQuantity[0]) : null,
        activeProductsWithoutSales: zeroSaleRows[0]?.total ?? "0",
        topProductsRevenueSharePercent: percentOf(contributionRevenue, productRevenue),
      },
      rankings: {
        byRevenue: byRevenue.slice(0, query.limit).map(product), byQuantity: byQuantity.slice(0, query.limit).map(product),
        lowPerforming: lowPerforming.slice(0, query.limit).map(product), growing: growing.slice(0, query.limit).map(product), declining: declining.slice(0, query.limit).map(product),
      },
      contribution: [
        ...contributionTop.map(product),
        ...(productRevenue > contributionRevenue ? [{ key: "others", productId: null, name: "سایر محصولات", status: "active" as const, revenueToman: compareMetric(productRevenue - contributionRevenue, 0n), quantitySold: compareMetric(0n, 0n), ordersContainingProduct: compareMetric(0n, 0n), revenueSharePercent: percentOf(productRevenue - contributionRevenue, productRevenue), quantitySharePercent: "0.00" }] : []),
      ],
      categories, categoryTrends,
      zeroSaleProducts: zeroSaleRows.map(({ productId, name, categoryName }) => ({ productId, name, categoryName })),
      totals: { productRevenueToman: productRevenue.toString(), quantitySold: productQuantity.toString() },
    };
  }

  async product(coffeeShopId: string, timezone: string, productId: string, query: AnalyticsQueryDto) {
    await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.Analytics);
    const info = (await this.dataSource.query<ProductInfoRow[]>(`
      SELECT id AS "productId", name,
             CASE WHEN deleted_at IS NOT NULL THEN 'archived' WHEN NOT is_available THEN 'unavailable' ELSE 'active' END AS status
      FROM menu_items WHERE id = $1 AND coffee_shop_id = $2
    `, [productId, coffeeShopId]))[0];
    if (!info) throw new NotFoundException("Product not found");
    const ranges = this.ranges(timezone, query);
    const granularity = analyticsGranularity(ranges.current);
    const [aggregate, points] = await Promise.all([
      this.dataSource.query<ProductDetailRow[]>(`
        WITH bounds AS (
          SELECT $3::timestamp AT TIME ZONE $6 AS previous_start,
                 $4::timestamp AT TIME ZONE $6 AS current_start,
                 $5::timestamp AT TIME ZONE $6 AS current_end
        ), eligible AS (
          SELECT o.id, o.status_changed_at, oi.menu_item_id, oi.quantity, oi.line_total_toman
          FROM orders o JOIN order_items oi ON oi.order_id = o.id AND oi.coffee_shop_id = o.coffee_shop_id
          CROSS JOIN bounds b
          WHERE o.coffee_shop_id = $1 AND o.status = $2::order_status
            AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_end
        )
        SELECT COALESCE(SUM(line_total_toman) FILTER (WHERE menu_item_id = $7 AND status_changed_at >= b.current_start), 0)::text AS "currentRevenue",
               COALESCE(SUM(quantity) FILTER (WHERE menu_item_id = $7 AND status_changed_at >= b.current_start), 0)::text AS "currentQuantity",
               COUNT(DISTINCT id) FILTER (WHERE menu_item_id = $7 AND status_changed_at >= b.current_start)::text AS "currentOrders",
               COALESCE(SUM(line_total_toman) FILTER (WHERE status_changed_at >= b.current_start), 0)::text AS "totalRevenue",
               COALESCE(SUM(line_total_toman) FILTER (WHERE menu_item_id = $7 AND status_changed_at < b.current_start), 0)::text AS "previousRevenue",
               COALESCE(SUM(quantity) FILTER (WHERE menu_item_id = $7 AND status_changed_at < b.current_start), 0)::text AS "previousQuantity",
               COUNT(DISTINCT id) FILTER (WHERE menu_item_id = $7 AND status_changed_at < b.current_start)::text AS "previousOrders"
        FROM eligible CROSS JOIN bounds b
      `, [coffeeShopId, COMPLETED_ORDER_STATUS, ranges.previous.start, ranges.current.start, ranges.current.endExclusive, timezone, productId]).then((rows) => rows[0]!),
      this.itemSeries(coffeeShopId, ranges, granularity, productId),
    ]);
    const quantity = BigInt(aggregate.currentQuantity);
    return {
      period: query.period, timezone, current: ranges.current, previous: ranges.previous, granularity, product: info,
      metrics: {
        revenueToman: compareMetric(BigInt(aggregate.currentRevenue), BigInt(aggregate.previousRevenue)),
        quantitySold: compareMetric(quantity, BigInt(aggregate.previousQuantity)),
        ordersContainingProduct: compareMetric(BigInt(aggregate.currentOrders), BigInt(aggregate.previousOrders)),
        averageSellingPriceToman: quantity === 0n ? "0" : ((BigInt(aggregate.currentRevenue) + quantity / 2n) / quantity).toString(),
        revenueSharePercent: percentOf(BigInt(aggregate.currentRevenue), BigInt(aggregate.totalRevenue)),
      },
      series: {
        revenueToman: { key: "revenueToman", label: "درآمد محصول", points: points.map((point) => ({ bucket: point.bucket, label: point.bucket, value: point.revenue })) },
        quantitySold: { key: "quantitySold", label: "تعداد فروش", points: points.map((point) => ({ bucket: point.bucket, label: point.bucket, value: point.quantity })) },
      },
    };
  }

  private series(coffeeShopId: string, ranges: AnalyticsRanges, granularity: AnalyticsGranularity): Promise<SeriesRow[]> {
    const { slots, bucket, textBucket } = this.seriesParts(granularity);
    return this.dataSource.query<SeriesRow[]>(`
      WITH bounds AS (
        SELECT $2::date AS local_start, $3::date AS local_end,
               $2::timestamp AT TIME ZONE $5 AS current_start,
               $3::timestamp AT TIME ZONE $5 AS current_end
      ), slots AS (${slots}), totals AS (
        SELECT ${bucket} AS bucket,
               SUM(o.total_amount_toman)::text AS revenue, COUNT(*)::text AS orders
        FROM orders o CROSS JOIN bounds b
        WHERE o.coffee_shop_id = $1 AND o.status = $4::order_status
          AND o.status_changed_at >= b.current_start AND o.status_changed_at < b.current_end
        GROUP BY 1
      )
      SELECT ${textBucket} AS bucket, COALESCE(t.revenue, '0') AS revenue, COALESCE(t.orders, '0') AS orders
      FROM slots s LEFT JOIN totals t ON t.bucket = s.bucket ORDER BY s.bucket
    `, [coffeeShopId, ranges.current.start, ranges.current.endExclusive, COMPLETED_ORDER_STATUS, ranges.timezone]);
  }

  private seriesParts(granularity: AnalyticsGranularity) {
    const slots: Record<AnalyticsGranularity, string> = {
      hour: `SELECT generate_series(b.current_start, b.current_end - interval '1 microsecond', interval '1 hour') AS bucket FROM bounds b`,
      day: `SELECT generate_series(b.local_start::date, b.local_end::date - 1, interval '1 day')::date AS bucket FROM bounds b`,
      week: `SELECT generate_series(b.local_start::date, b.local_end::date - 1, interval '7 days')::date AS bucket FROM bounds b`,
      month: `SELECT generate_series(date_trunc('month', b.local_start::timestamp), date_trunc('month', (b.local_end::date - 1)::timestamp), interval '1 month')::date AS bucket FROM bounds b`,
      year: `SELECT generate_series(date_trunc('year', b.local_start::timestamp), date_trunc('year', (b.local_end::date - 1)::timestamp), interval '1 year')::date AS bucket FROM bounds b`,
    };
    const bucket: Record<AnalyticsGranularity, string> = {
      hour: `date_bin('1 hour', o.status_changed_at, b.current_start)`,
      day: `(o.status_changed_at AT TIME ZONE $5)::date`,
      week: `b.local_start::date + ((((o.status_changed_at AT TIME ZONE $5)::date - b.local_start::date) / 7) * 7)`,
      month: `date_trunc('month', o.status_changed_at AT TIME ZONE $5)::date`,
      year: `date_trunc('year', o.status_changed_at AT TIME ZONE $5)::date`,
    };
    return { slots: slots[granularity], bucket: bucket[granularity], textBucket: granularity === "hour" ? `to_char(s.bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` : `s.bucket::text` };
  }

  private itemSeries(coffeeShopId: string, ranges: AnalyticsRanges, granularity: AnalyticsGranularity, productId: string): Promise<ItemSeriesRow[]> {
    const { slots, bucket, textBucket } = this.seriesParts(granularity);
    return this.dataSource.query<ItemSeriesRow[]>(`
      WITH bounds AS (
        SELECT $2::date AS local_start, $3::date AS local_end,
               $2::timestamp AT TIME ZONE $5 AS current_start,
               $3::timestamp AT TIME ZONE $5 AS current_end
      ), slots AS (${slots}), totals AS (
        SELECT ${bucket} AS bucket, SUM(oi.line_total_toman)::text AS revenue,
               SUM(oi.quantity)::text AS quantity, COUNT(DISTINCT o.id)::text AS orders
        FROM orders o JOIN order_items oi ON oi.order_id = o.id AND oi.coffee_shop_id = o.coffee_shop_id CROSS JOIN bounds b
        WHERE o.coffee_shop_id = $1 AND o.status = $4::order_status
          AND oi.menu_item_id = $6
          AND o.status_changed_at >= b.current_start AND o.status_changed_at < b.current_end
        GROUP BY 1
      )
      SELECT ${textBucket} AS bucket, COALESCE(t.revenue, '0') AS revenue,
             COALESCE(t.quantity, '0') AS quantity, COALESCE(t.orders, '0') AS orders
      FROM slots s LEFT JOIN totals t ON t.bucket = s.bucket ORDER BY s.bucket
    `, [coffeeShopId, ranges.current.start, ranges.current.endExclusive, COMPLETED_ORDER_STATUS, ranges.timezone, productId]);
  }

  private categorySeries(coffeeShopId: string, ranges: AnalyticsRanges, granularity: AnalyticsGranularity, limit: number): Promise<CategorySeriesRow[]> {
    const { slots, bucket, textBucket } = this.seriesParts(granularity);
    return this.dataSource.query<CategorySeriesRow[]>(`
      WITH bounds AS (
        SELECT $2::date AS local_start, $3::date AS local_end,
               $2::timestamp AT TIME ZONE $5 AS current_start,
               $3::timestamp AT TIME ZONE $5 AS current_end
      ), eligible AS (
        SELECT o.id, o.status_changed_at, oi.category_id_snapshot, oi.category_name_snapshot, oi.quantity, oi.line_total_toman
        FROM orders o JOIN order_items oi ON oi.order_id = o.id AND oi.coffee_shop_id = o.coffee_shop_id CROSS JOIN bounds b
        WHERE o.coffee_shop_id = $1 AND o.status = $4::order_status
          AND o.status_changed_at >= b.current_start AND o.status_changed_at < b.current_end
      ), top_categories AS (
        SELECT COALESCE(category_id_snapshot::text, 'uncategorized') AS key, category_id_snapshot AS "categoryId",
               COALESCE((array_agg(category_name_snapshot ORDER BY status_changed_at DESC) FILTER (WHERE category_name_snapshot IS NOT NULL))[1], 'بدون دسته‌بندی') AS name
        FROM eligible GROUP BY category_id_snapshot ORDER BY SUM(line_total_toman) DESC LIMIT $6
      ), slots AS (${slots}), totals AS (
        SELECT COALESCE(e.category_id_snapshot::text, 'uncategorized') AS key, ${bucket.replaceAll("o.", "e.")} AS bucket,
               SUM(e.line_total_toman)::text AS revenue, SUM(e.quantity)::text AS quantity, COUNT(DISTINCT e.id)::text AS orders
        FROM eligible e CROSS JOIN bounds b GROUP BY 1, 2
      )
      SELECT c.key, c."categoryId", c.name, ${textBucket} AS bucket,
             COALESCE(t.revenue, '0') AS revenue, COALESCE(t.quantity, '0') AS quantity, COALESCE(t.orders, '0') AS orders
      FROM top_categories c CROSS JOIN slots s LEFT JOIN totals t ON t.key = c.key AND t.bucket = s.bucket
      ORDER BY c.name, s.bucket
    `, [coffeeShopId, ranges.current.start, ranges.current.endExclusive, COMPLETED_ORDER_STATUS, ranges.timezone, limit]);
  }
}
