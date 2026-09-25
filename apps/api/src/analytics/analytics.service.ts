import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CANCELLED_ORDER_STATUS, COMPLETED_ORDER_STATUS } from "../ordering/order-status.util";
import { OrderDeliveryMethod, OrderSource, OrderStatus } from "../ordering/entities";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { AnalyticsQueryDto, compareMetric, percentOf, ProductAnalyticsQueryDto, CustomerAnalyticsQueryDto } from "./analytics.dto";
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
interface OrderSummaryRow {
  created: string; previousCreated: string; completed: string; previousCompleted: string;
  cancelled: string; previousCancelled: string; cancelledValue: string; previousCancelledValue: string;
}
interface OrderStatusRow { status: OrderStatus; orders: string }
interface OrderOutcomeRow { bucket: string; status: OrderStatus; orders: string }
interface OrderItemsRow { period: "current" | "previous"; bucket: string; completedOrders: string; totalItems: string }
interface OrderDimensionRow {
  dimension: "fulfillment" | "source"; key: string;
  created: string; previousCreated: string; completed: string; previousCompleted: string;
  revenue: string; previousRevenue: string;
}
export interface OrderRateMetric { value: string | null; previousValue: string | null; change: string | null; changePercent: string | null }
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
interface CustomerSummaryRow {
  currentRevenue: string; currentOrders: string; currentCustomers: string; currentNew: string; currentReturning: string;
  currentNewRevenue: string; currentReturningRevenue: string;
  previousRevenue: string; previousOrders: string; previousCustomers: string; previousNew: string; previousReturning: string;
}
interface CustomerTrendRow { bucket: string; uniqueCustomers: string; newCustomers: string; returningCustomers: string }
interface CustomerRankingRow {
  customerId: string | null; displayName: string | null; revenue: string | null; orders: string | null;
  averageOrderValue: string | null; firstOrderAt: Date | null; lastOrderAt: Date | null; daysSinceLastOrder: string | null;
  lifetimeRevenue: string | null; lifetimeOrders: string | null; revenueRank: string | null; orderRank: string | null;
  oneTimeCustomers: string; repeatCustomers: string; distribution2to3: string; distribution4to5: string;
  distribution6to10: string; distribution11plus: string; topTenRevenue: string; knownRevenue: string;
  averageDaysBetweenOrders: string | null;
}
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

function fixed(value: bigint) {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function fixedMetric(value: bigint, previousValue: bigint): OrderRateMetric {
  const change = value - previousValue;
  const absolute = change < 0n ? -change : change;
  const relative = previousValue === 0n ? null : absolute * 10000n / previousValue;
  return {
    value: fixed(value), previousValue: fixed(previousValue), change: fixed(change),
    changePercent: relative === null ? null : `${change < 0n ? "-" : ""}${fixed(relative)}`,
  };
}

function rateMetric(numerator: bigint, denominator: bigint, previousNumerator: bigint, previousDenominator: bigint): OrderRateMetric {
  if (denominator === 0n || previousDenominator === 0n) {
    return {
      value: denominator === 0n ? null : fixed(numerator * 10000n / denominator),
      previousValue: previousDenominator === 0n ? null : fixed(previousNumerator * 10000n / previousDenominator),
      change: null, changePercent: null,
    };
  }
  return fixedMetric(numerator * 10000n / denominator, previousNumerator * 10000n / previousDenominator);
}

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

  async orders(coffeeShopId: string, timezone: string, query: AnalyticsQueryDto) {
    await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.Analytics);
    const ranges = this.ranges(timezone, query);
    const granularity = analyticsGranularity(ranges.current);
    const params = [coffeeShopId, ranges.previous.start, ranges.current.start, ranges.current.endExclusive, timezone, COMPLETED_ORDER_STATUS, CANCELLED_ORDER_STATUS];
    const trendParams = [coffeeShopId, ranges.current.start, ranges.current.endExclusive, COMPLETED_ORDER_STATUS, timezone, CANCELLED_ORDER_STATUS];
    const { slots, bucket, textBucket } = this.seriesParts(granularity);
    const [summaryRows, statusRows, outcomeRows, itemRows, dimensionRows] = await Promise.all([
      this.dataSource.query<OrderSummaryRow[]>(`
        WITH bounds AS (
          SELECT $2::timestamp AT TIME ZONE $5 AS previous_start,
                 $3::timestamp AT TIME ZONE $5 AS current_start,
                 $4::timestamp AT TIME ZONE $5 AS current_end
        )
        SELECT COUNT(*) FILTER (WHERE o.created_at >= b.current_start AND o.created_at < b.current_end)::text AS created,
               COUNT(*) FILTER (WHERE o.created_at >= b.previous_start AND o.created_at < b.current_start)::text AS "previousCreated",
               COUNT(*) FILTER (WHERE o.status = $6::order_status AND o.status_changed_at >= b.current_start AND o.status_changed_at < b.current_end)::text AS completed,
               COUNT(*) FILTER (WHERE o.status = $6::order_status AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_start)::text AS "previousCompleted",
               COUNT(*) FILTER (WHERE o.status = $7::order_status AND o.status_changed_at >= b.current_start AND o.status_changed_at < b.current_end)::text AS cancelled,
               COUNT(*) FILTER (WHERE o.status = $7::order_status AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_start)::text AS "previousCancelled",
               COALESCE(SUM(o.total_amount_toman) FILTER (WHERE o.status = $7::order_status AND o.status_changed_at >= b.current_start AND o.status_changed_at < b.current_end), 0)::text AS "cancelledValue",
               COALESCE(SUM(o.total_amount_toman) FILTER (WHERE o.status = $7::order_status AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_start), 0)::text AS "previousCancelledValue"
        FROM orders o CROSS JOIN bounds b
        WHERE o.coffee_shop_id = $1 AND (
          (o.created_at >= b.previous_start AND o.created_at < b.current_end) OR
          (o.status IN ($6::order_status, $7::order_status) AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_end)
        )
      `, params),
      this.dataSource.query<OrderStatusRow[]>(`
        WITH bounds AS (SELECT $2::timestamp AT TIME ZONE $4 AS start_at, $3::timestamp AT TIME ZONE $4 AS end_at)
        SELECT o.status, COUNT(*)::text AS orders
        FROM orders o CROSS JOIN bounds b
        WHERE o.coffee_shop_id = $1 AND o.created_at >= b.start_at AND o.created_at < b.end_at
        GROUP BY o.status
      `, [coffeeShopId, ranges.current.start, ranges.current.endExclusive, timezone]),
      this.dataSource.query<OrderOutcomeRow[]>(`
        WITH bounds AS (
          SELECT $2::date AS local_start, $3::date AS local_end,
                 $2::timestamp AT TIME ZONE $5 AS current_start,
                 $3::timestamp AT TIME ZONE $5 AS current_end
        ), slots AS (${slots}), outcomes AS (
          SELECT * FROM (VALUES ($4::order_status), ($6::order_status)) AS outcome(status)
        ), totals AS (
          SELECT ${bucket} AS bucket, o.status, COUNT(*)::text AS orders
          FROM orders o CROSS JOIN bounds b
          WHERE o.coffee_shop_id = $1 AND o.status IN ($4::order_status, $6::order_status)
            AND o.status_changed_at >= b.current_start AND o.status_changed_at < b.current_end
          GROUP BY 1, 2
        )
        SELECT ${textBucket} AS bucket, outcome.status, COALESCE(t.orders, '0') AS orders
        FROM slots s CROSS JOIN outcomes outcome
        LEFT JOIN totals t ON t.bucket = s.bucket AND t.status = outcome.status
        ORDER BY s.bucket, outcome.status
      `, trendParams),
      this.dataSource.query<OrderItemsRow[]>(`
        WITH bounds AS (
          SELECT $2::timestamp AT TIME ZONE $5 AS previous_start,
                 $3::timestamp AT TIME ZONE $5 AS current_start,
                 $4::timestamp AT TIME ZONE $5 AS current_end
        ), per_order AS (
          SELECT CASE WHEN o.status_changed_at < b.current_start THEN 'previous' ELSE 'current' END AS period,
                 o.id,
                 COALESCE(SUM(oi.quantity), 0)::bigint AS item_quantity
          FROM orders o CROSS JOIN bounds b
          LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.coffee_shop_id = o.coffee_shop_id
          WHERE o.coffee_shop_id = $1 AND o.status = $6::order_status
            AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_end
          GROUP BY o.id, o.status_changed_at, b.current_start
        ), bucketed AS (
          SELECT period, item_quantity,
                 CASE WHEN item_quantity = 0 THEN 'zero' WHEN item_quantity = 1 THEN 'one'
                      WHEN item_quantity = 2 THEN 'two' WHEN item_quantity BETWEEN 3 AND 4 THEN 'threeToFour'
                      WHEN item_quantity BETWEEN 5 AND 7 THEN 'fiveToSeven' ELSE 'eightPlus' END AS bucket
          FROM per_order
        )
        SELECT period, CASE WHEN GROUPING(bucket) = 1 THEN 'ALL' ELSE bucket END AS bucket,
               COUNT(*)::text AS "completedOrders", COALESCE(SUM(item_quantity), 0)::text AS "totalItems"
        FROM bucketed
        GROUP BY GROUPING SETS ((period), (period, bucket))
      `, params.slice(0, 6)),
      this.dataSource.query<OrderDimensionRow[]>(`
        WITH bounds AS (
          SELECT $2::timestamp AT TIME ZONE $5 AS previous_start,
                 $3::timestamp AT TIME ZONE $5 AS current_start,
                 $4::timestamp AT TIME ZONE $5 AS current_end
        ), scoped AS (
          SELECT o.delivery_method, o.order_source, o.status, o.total_amount_toman,
                 o.created_at >= b.current_start AND o.created_at < b.current_end AS created_current,
                 o.created_at >= b.previous_start AND o.created_at < b.current_start AS created_previous,
                 o.status = $6::order_status AND o.status_changed_at >= b.current_start AND o.status_changed_at < b.current_end AS completed_current,
                 o.status = $6::order_status AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_start AS completed_previous
          FROM orders o CROSS JOIN bounds b
          WHERE o.coffee_shop_id = $1 AND (
            (o.created_at >= b.previous_start AND o.created_at < b.current_end) OR
            (o.status = $6::order_status AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_end)
          )
        )
        SELECT CASE WHEN GROUPING(delivery_method) = 0 THEN 'fulfillment' ELSE 'source' END AS dimension,
               CASE WHEN GROUPING(delivery_method) = 0 THEN COALESCE(delivery_method::text, 'UNKNOWN')
                    ELSE COALESCE(order_source::text, 'UNKNOWN') END AS key,
               COUNT(*) FILTER (WHERE created_current)::text AS created,
               COUNT(*) FILTER (WHERE created_previous)::text AS "previousCreated",
               COUNT(*) FILTER (WHERE completed_current)::text AS completed,
               COUNT(*) FILTER (WHERE completed_previous)::text AS "previousCompleted",
               COALESCE(SUM(total_amount_toman) FILTER (WHERE completed_current), 0)::text AS revenue,
               COALESCE(SUM(total_amount_toman) FILTER (WHERE completed_previous), 0)::text AS "previousRevenue"
        FROM scoped
        GROUP BY GROUPING SETS ((delivery_method), (order_source))
      `, params.slice(0, 6)),
    ]);

    const summary = summaryRows[0]!;
    const currentCreated = BigInt(summary.created), previousCreated = BigInt(summary.previousCreated);
    const currentCompleted = BigInt(summary.completed), previousCompleted = BigInt(summary.previousCompleted);
    const currentCancelled = BigInt(summary.cancelled), previousCancelled = BigInt(summary.previousCancelled);
    const currentTerminal = currentCompleted + currentCancelled, previousTerminal = previousCompleted + previousCancelled;
    const allCurrentItems = itemRows.find((row) => row.period === "current" && row.bucket === "ALL");
    const allPreviousItems = itemRows.find((row) => row.period === "previous" && row.bucket === "ALL");
    const averageItems = (row: OrderItemsRow | undefined) => {
      const count = BigInt(row?.completedOrders ?? "0");
      return count === 0n ? 0n : (BigInt(row?.totalItems ?? "0") * 100n + count / 2n) / count;
    };
    const metric = (name: "fulfillment" | "source") => dimensionRows.filter((row) => row.dimension === name);
    const totalRevenue = (rows: OrderDimensionRow[], field: "revenue" | "previousRevenue") => rows.reduce((sum, row) => sum + BigInt(row[field]), 0n);
    const dimension = (row: OrderDimensionRow, kind: "fulfillment" | "source", rows: OrderDimensionRow[]) => {
      const completed = BigInt(row.completed), previousCompletedCount = BigInt(row.previousCompleted);
      const revenue = BigInt(row.revenue), previousRevenue = BigInt(row.previousRevenue);
      return {
        [kind === "fulfillment" ? "fulfillmentType" : "source"]: row.key,
        totalOrders: compareMetric(BigInt(row.created), BigInt(row.previousCreated)),
        completedOrders: compareMetric(completed, previousCompletedCount),
        revenueToman: compareMetric(revenue, previousRevenue),
        averageOrderValueToman: compareMetric(
          completed === 0n ? 0n : (revenue + completed / 2n) / completed,
          previousCompletedCount === 0n ? 0n : (previousRevenue + previousCompletedCount / 2n) / previousCompletedCount,
        ),
        orderSharePercent: percentOf(BigInt(row.created), currentCreated),
        previousOrderSharePercent: percentOf(BigInt(row.previousCreated), previousCreated),
        completedOrderSharePercent: percentOf(completed, currentCompleted),
        previousCompletedOrderSharePercent: percentOf(previousCompletedCount, previousCompleted),
        revenueSharePercent: percentOf(revenue, totalRevenue(rows, "revenue")),
        previousRevenueSharePercent: percentOf(previousRevenue, totalRevenue(rows, "previousRevenue")),
      };
    };
    const fulfillmentRows = metric("fulfillment");
    const sourceRows = metric("source");
    const statuses = Object.values(OrderStatus);
    const statusCounts = new Map(statusRows.map((row) => [row.status, BigInt(row.orders)]));
    const createdStatusTotal = [...statusCounts.values()].reduce((sum, count) => sum + count, 0n);
    const outcomeSeries = (status: OrderStatus) => ({
      key: status, label: status,
      points: outcomeRows.filter((row) => row.status === status).map((row) => ({ bucket: row.bucket, label: row.bucket, value: row.orders })),
    });
    const sizeBuckets = ["zero", "one", "two", "threeToFour", "fiveToSeven", "eightPlus"] as const;

    return {
      period: query.period, timezone, current: ranges.current, previous: ranges.previous, granularity,
      metrics: {
        totalOrdersCreated: compareMetric(currentCreated, previousCreated),
        completedOrders: compareMetric(currentCompleted, previousCompleted),
        cancelledOrders: compareMetric(currentCancelled, previousCancelled),
        completionRate: rateMetric(currentCompleted, currentTerminal, previousCompleted, previousTerminal),
        cancellationRate: rateMetric(currentCancelled, currentTerminal, previousCancelled, previousTerminal),
        cancelledOrderValueToman: compareMetric(BigInt(summary.cancelledValue), BigInt(summary.previousCancelledValue)),
        averageItemsPerOrder: fixedMetric(averageItems(allCurrentItems), averageItems(allPreviousItems)),
      },
      statusBreakdown: statuses.map((status) => {
        const count = statusCounts.get(status) ?? 0n;
        return { status, orderCount: count.toString(), sharePercent: percentOf(count, createdStatusTotal) };
      }),
      outcomeTrend: [outcomeSeries(COMPLETED_ORDER_STATUS), outcomeSeries(CANCELLED_ORDER_STATUS)],
      orderSizeDistribution: sizeBuckets.map((key) => ({
        key,
        orders: itemRows.find((row) => row.period === "current" && row.bucket === key)?.completedOrders ?? "0",
      })),
      fulfillment: [OrderDeliveryMethod.Pickup, OrderDeliveryMethod.Courier].map((type) => {
        const row = fulfillmentRows.find((item) => item.key === type) ?? {
          dimension: "fulfillment" as const, key: type, created: "0", previousCreated: "0", completed: "0", previousCompleted: "0", revenue: "0", previousRevenue: "0",
        };
        return dimension(row, "fulfillment", fulfillmentRows);
      }),
      sources: [...sourceRows]
        .sort((left, right) => compareBigInt(BigInt(right.revenue), BigInt(left.revenue)) || compareBigInt(BigInt(right.created), BigInt(left.created)) || left.key.localeCompare(right.key))
        .map((row) => dimension(row, "source", sourceRows)),
    };
  }

  async customers(coffeeShopId: string, timezone: string, query: CustomerAnalyticsQueryDto) {
    await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.Analytics);
    const ranges = this.ranges(timezone, query);
    const granularity = analyticsGranularity(ranges.current);
    const params = [coffeeShopId, ranges.previous.start, ranges.current.start, ranges.current.endExclusive, timezone, COMPLETED_ORDER_STATUS];
    const [summaryRows, trends, rankingRows] = await Promise.all([
      this.dataSource.query<CustomerSummaryRow[]>(`
        WITH bounds AS (
          SELECT $2::timestamp AT TIME ZONE $5 AS previous_start,
                 $3::timestamp AT TIME ZONE $5 AS current_start,
                 $4::timestamp AT TIME ZONE $5 AS current_end
        ), first_purchase AS (
          SELECT o.client_id, MIN(o.status_changed_at) AS first_at
          FROM orders o CROSS JOIN bounds b
          WHERE o.coffee_shop_id = $1 AND o.status = $6::order_status
            AND o.status_changed_at < b.current_end
          GROUP BY o.client_id
        ), period_customers AS (
          SELECT o.client_id,
                 COUNT(*) FILTER (WHERE o.status_changed_at >= b.current_start)::text AS current_orders,
                 COALESCE(SUM(o.total_amount_toman) FILTER (WHERE o.status_changed_at >= b.current_start), 0)::text AS current_revenue,
                 COUNT(*) FILTER (WHERE o.status_changed_at < b.current_start)::text AS previous_orders,
                 COALESCE(SUM(o.total_amount_toman) FILTER (WHERE o.status_changed_at < b.current_start), 0)::text AS previous_revenue
          FROM orders o CROSS JOIN bounds b
          WHERE o.coffee_shop_id = $1 AND o.status = $6::order_status
            AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_end
          GROUP BY o.client_id
        ), classified AS (
          SELECT p.*, f.first_at, b.previous_start, b.current_start
          FROM period_customers p JOIN first_purchase f USING (client_id) CROSS JOIN bounds b
        )
        SELECT COALESCE(SUM(current_revenue::bigint), 0)::text AS "currentRevenue",
               COALESCE(SUM(current_orders::bigint), 0)::text AS "currentOrders",
               COUNT(*) FILTER (WHERE current_orders::bigint > 0)::text AS "currentCustomers",
               COUNT(*) FILTER (WHERE current_orders::bigint > 0 AND first_at >= current_start)::text AS "currentNew",
               COUNT(*) FILTER (WHERE current_orders::bigint > 0 AND first_at < current_start)::text AS "currentReturning",
               COALESCE(SUM(current_revenue::bigint) FILTER (WHERE current_orders::bigint > 0 AND first_at >= current_start), 0)::text AS "currentNewRevenue",
               COALESCE(SUM(current_revenue::bigint) FILTER (WHERE current_orders::bigint > 0 AND first_at < current_start), 0)::text AS "currentReturningRevenue",
               COALESCE(SUM(previous_revenue::bigint), 0)::text AS "previousRevenue",
               COALESCE(SUM(previous_orders::bigint), 0)::text AS "previousOrders",
               COUNT(*) FILTER (WHERE previous_orders::bigint > 0)::text AS "previousCustomers",
               COUNT(*) FILTER (WHERE previous_orders::bigint > 0 AND first_at >= previous_start)::text AS "previousNew",
               COUNT(*) FILTER (WHERE previous_orders::bigint > 0 AND first_at < previous_start)::text AS "previousReturning"
        FROM classified
      `, params),
      this.customerTrends(coffeeShopId, ranges, granularity),
      this.customerRankings(coffeeShopId, ranges, timezone, query.limit),
    ]);
    const summary = summaryRows[0]!;
    const currentRevenue = BigInt(summary.currentRevenue), previousRevenue = BigInt(summary.previousRevenue);
    const currentOrders = BigInt(summary.currentOrders), previousOrders = BigInt(summary.previousOrders);
    const currentCustomers = BigInt(summary.currentCustomers), previousCustomers = BigInt(summary.previousCustomers);
    const currentNew = BigInt(summary.currentNew), previousNew = BigInt(summary.previousNew);
    const currentReturning = BigInt(summary.currentReturning), previousReturning = BigInt(summary.previousReturning);
    const averageRevenue = (revenue: bigint, customers: bigint) => customers === 0n ? 0n : (revenue + customers / 2n) / customers;
    const ratioMetric = (numerator: bigint, denominator: bigint, oldNumerator: bigint, oldDenominator: bigint) => {
      const scaled = (n: bigint, d: bigint) => d === 0n ? 0n : (n * 100n + d / 2n) / d;
      const value = scaled(numerator, denominator), previousValue = scaled(oldNumerator, oldDenominator), change = value - previousValue;
      const absolute = change < 0n ? -change : change;
      const changePercent = previousValue === 0n ? null : `${change < 0n ? "-" : ""}${(absolute * 10000n / previousValue) / 100n}.${String((absolute * 10000n / previousValue) % 100n).padStart(2, "0")}`;
      const decimal = (amount: bigint) => `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
      return { value: decimal(value), previousValue: decimal(previousValue), change: `${change < 0n ? "-" : ""}${decimal(absolute)}`, changePercent };
    };
    const rateMetric = (numerator: bigint, denominator: bigint, oldNumerator: bigint, oldDenominator: bigint) => {
      const scaled = (n: bigint, d: bigint) => d === 0n ? 0n : n * 10000n / d;
      const value = scaled(numerator, denominator), previousValue = scaled(oldNumerator, oldDenominator), change = value - previousValue;
      const absolute = change < 0n ? -change : change;
      const relative = previousValue === 0n ? null : absolute * 10000n / previousValue;
      const decimal = (amount: bigint) => `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
      return {
        value: decimal(value), previousValue: decimal(previousValue),
        change: `${change < 0n ? "-" : ""}${decimal(absolute)}`,
        changePercent: relative === null ? null : `${change < 0n ? "-" : ""}${decimal(relative)}`,
      };
    };
    const ranking = (row: CustomerRankingRow) => ({
      customerId: row.customerId!, displayName: row.displayName || "نامشخص",
      revenueToman: row.revenue!, orderCount: row.orders!, averageOrderValueToman: row.averageOrderValue!,
      firstOrderAt: row.firstOrderAt, lastOrderAt: row.lastOrderAt, daysSinceLastOrder: row.daysSinceLastOrder!,
      lifetimeRevenueToman: row.lifetimeRevenue!, lifetimeOrderCount: row.lifetimeOrders!,
    });
    const activeRows = rankingRows.filter((row) => row.customerId !== null);
    const oneTimeCustomers = BigInt(rankingRows[0]?.oneTimeCustomers ?? "0");
    const repeatCustomers = BigInt(rankingRows[0]?.repeatCustomers ?? "0");
    const distribution = [
      { key: "one", label: "۱ سفارش", customers: oneTimeCustomers.toString() },
      { key: "twoToThree", label: "۲ تا ۳ سفارش", customers: rankingRows[0]?.distribution2to3 ?? "0" },
      { key: "fourToFive", label: "۴ تا ۵ سفارش", customers: rankingRows[0]?.distribution4to5 ?? "0" },
      { key: "sixToTen", label: "۶ تا ۱۰ سفارش", customers: rankingRows[0]?.distribution6to10 ?? "0" },
      { key: "elevenPlus", label: "۱۱ سفارش یا بیشتر", customers: rankingRows[0]?.distribution11plus ?? "0" },
    ];
    const trendSeries = (key: string, label: string, field: "uniqueCustomers" | "newCustomers" | "returningCustomers") => ({
      key, label, points: trends.map((point) => ({ bucket: point.bucket, label: point.bucket, value: point[field] })),
    });
    return {
      period: query.period, timezone, current: ranges.current, previous: ranges.previous, granularity,
      metrics: {
        uniqueCustomers: compareMetric(currentCustomers, previousCustomers),
        newCustomers: compareMetric(currentNew, previousNew),
        returningCustomers: compareMetric(currentReturning, previousReturning),
        returningCustomerRate: rateMetric(currentReturning, currentCustomers, previousReturning, previousCustomers),
        averageRevenuePerCustomerToman: compareMetric(averageRevenue(currentRevenue, currentCustomers), averageRevenue(previousRevenue, previousCustomers)),
        averageOrdersPerCustomer: ratioMetric(currentOrders, currentCustomers, previousOrders, previousCustomers),
        knownCustomerRevenueToman: compareMetric(currentRevenue, previousRevenue),
      },
      newVsReturning: [
        { key: "new", label: "جدید", customers: currentNew.toString(), customerSharePercent: percentOf(currentNew, currentCustomers), revenueToman: summary.currentNewRevenue, revenueSharePercent: percentOf(BigInt(summary.currentNewRevenue), currentRevenue) },
        { key: "returning", label: "بازگشتی", customers: currentReturning.toString(), customerSharePercent: percentOf(currentReturning, currentCustomers), revenueToman: summary.currentReturningRevenue, revenueSharePercent: percentOf(BigInt(summary.currentReturningRevenue), currentRevenue) },
      ],
      coverage: {
        identifiedRevenuePercent: currentRevenue === 0n ? null : "100.00",
        identifiedOrderPercent: currentOrders === 0n ? null : "100.00",
        anonymousRevenueToman: "0", anonymousOrders: "0",
      },
      behavior: {
        averageDaysBetweenOrders: rankingRows[0]?.averageDaysBetweenOrders ?? null,
        oneTimeCustomers: oneTimeCustomers.toString(), repeatCustomers: repeatCustomers.toString(), orderCountDistribution: distribution,
        topTenRevenueSharePercent: percentOf(BigInt(rankingRows[0]?.topTenRevenue ?? "0"), BigInt(rankingRows[0]?.knownRevenue ?? "0")),
      },
      trends: {
        uniqueCustomers: trendSeries("uniqueCustomers", "مشتریان یکتا", "uniqueCustomers"),
        newCustomers: trendSeries("newCustomers", "مشتریان جدید", "newCustomers"),
        returningCustomers: trendSeries("returningCustomers", "مشتریان بازگشتی", "returningCustomers"),
      },
      rankings: {
        byRevenue: activeRows.filter((row) => Number(row.revenueRank) <= query.limit).sort((a, b) => Number(a.revenueRank) - Number(b.revenueRank)).map(ranking),
        byOrderCount: activeRows.filter((row) => Number(row.orderRank) <= query.limit).sort((a, b) => Number(a.orderRank) - Number(b.orderRank)).map(ranking),
      },
    };
  }

  private customerTrends(coffeeShopId: string, ranges: AnalyticsRanges, granularity: AnalyticsGranularity): Promise<CustomerTrendRow[]> {
    const { slots, bucket, textBucket } = this.seriesParts(granularity);
    return this.dataSource.query<CustomerTrendRow[]>(`
      WITH bounds AS (
        SELECT $2::date AS local_start, $3::date AS local_end,
               $2::timestamp AT TIME ZONE $5 AS current_start,
               $3::timestamp AT TIME ZONE $5 AS current_end
      ), slots AS (${slots}), active AS (
        SELECT o.client_id, ${bucket} AS bucket
        FROM orders o CROSS JOIN bounds b
        WHERE o.coffee_shop_id = $1 AND o.status = $4::order_status
          AND o.status_changed_at >= b.current_start AND o.status_changed_at < b.current_end
        GROUP BY o.client_id, ${bucket}
      ), first_purchase AS (
        SELECT o.client_id, MIN(o.status_changed_at) AS status_changed_at
        FROM orders o CROSS JOIN bounds b
        WHERE o.coffee_shop_id = $1 AND o.status = $4::order_status
          AND o.status_changed_at < b.current_end
        GROUP BY o.client_id
      ), first_buckets AS (
        SELECT f.client_id, f.status_changed_at,
               CASE WHEN f.status_changed_at < b.current_start THEN NULL ELSE ${bucket.replaceAll("o.", "f.")} END AS bucket
        FROM first_purchase f CROSS JOIN bounds b
      ), totals AS (
        SELECT a.bucket, COUNT(*)::text AS unique_customers,
               COUNT(*) FILTER (WHERE f.bucket = a.bucket)::text AS new_customers,
               COUNT(*) FILTER (WHERE f.status_changed_at < b.current_start OR f.bucket < a.bucket)::text AS returning_customers
        FROM active a JOIN first_buckets f USING (client_id) CROSS JOIN bounds b
        GROUP BY a.bucket
      )
      SELECT ${textBucket} AS bucket, COALESCE(t.unique_customers, '0') AS "uniqueCustomers",
             COALESCE(t.new_customers, '0') AS "newCustomers", COALESCE(t.returning_customers, '0') AS "returningCustomers"
      FROM slots s LEFT JOIN totals t ON t.bucket = s.bucket ORDER BY s.bucket
    `, [coffeeShopId, ranges.current.start, ranges.current.endExclusive, COMPLETED_ORDER_STATUS, ranges.timezone]);
  }

  private customerRankings(coffeeShopId: string, ranges: AnalyticsRanges, timezone: string, limit: number): Promise<CustomerRankingRow[]> {
    return this.dataSource.query<CustomerRankingRow[]>(`
      WITH bounds AS (
        SELECT $2::timestamp AT TIME ZONE $4 AS current_start,
               $3::timestamp AT TIME ZONE $4 AS current_end
      ), active AS (
        SELECT o.client_id, SUM(o.total_amount_toman)::bigint AS revenue, COUNT(*)::bigint AS orders
        FROM orders o CROSS JOIN bounds b
        WHERE o.coffee_shop_id = $1 AND o.status = $5::order_status
          AND o.status_changed_at >= b.current_start AND o.status_changed_at < b.current_end
        GROUP BY o.client_id
      ), lifetime AS (
        SELECT o.client_id, SUM(o.total_amount_toman)::bigint AS revenue, COUNT(*)::bigint AS orders,
               MIN(o.status_changed_at) AS first_at, MAX(o.status_changed_at) AS last_at
        FROM orders o JOIN active a USING (client_id)
        WHERE o.coffee_shop_id = $1 AND o.status = $5::order_status
        GROUP BY o.client_id
      ), ranked AS (
        SELECT a.client_id, NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '') AS display_name,
               a.revenue, a.orders, l.revenue AS lifetime_revenue, l.orders AS lifetime_orders,
               l.first_at, l.last_at,
               ((now() AT TIME ZONE $4)::date - (l.last_at AT TIME ZONE $4)::date)::text AS days_since_last,
               ROW_NUMBER() OVER (ORDER BY a.revenue DESC, a.orders DESC, a.client_id) AS revenue_rank,
               ROW_NUMBER() OVER (ORDER BY a.orders DESC, a.revenue DESC, a.client_id) AS order_rank
        FROM active a JOIN lifetime l USING (client_id)
        LEFT JOIN clients c ON c.id = a.client_id AND c.coffee_shop_id = $1
      ), stats AS (
        SELECT COUNT(*) FILTER (WHERE lifetime_orders = 1)::text AS one_time,
               COUNT(*) FILTER (WHERE lifetime_orders >= 2)::text AS repeat,
               COUNT(*) FILTER (WHERE lifetime_orders BETWEEN 2 AND 3)::text AS distribution_2_3,
               COUNT(*) FILTER (WHERE lifetime_orders BETWEEN 4 AND 5)::text AS distribution_4_5,
               COUNT(*) FILTER (WHERE lifetime_orders BETWEEN 6 AND 10)::text AS distribution_6_10,
               COUNT(*) FILTER (WHERE lifetime_orders >= 11)::text AS distribution_11_plus,
               COALESCE(SUM(revenue), 0)::text AS known_revenue,
               COALESCE((SELECT SUM(top.revenue) FROM (SELECT revenue FROM ranked ORDER BY revenue DESC, client_id LIMIT 10) top), 0)::text AS top_ten_revenue
        FROM ranked
      ), order_gaps AS (
        SELECT o.status_changed_at - LAG(o.status_changed_at) OVER (PARTITION BY o.client_id ORDER BY o.status_changed_at) AS gap
        FROM orders o
        WHERE o.coffee_shop_id = $1 AND o.status = $5::order_status
      ), average_gap AS (
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM gap) / 86400)::numeric, 1)::text AS average_days
        FROM order_gaps WHERE gap IS NOT NULL
      )
      SELECT r.client_id AS "customerId", r.display_name AS "displayName", r.revenue::text AS revenue,
             r.orders::text AS orders,
             CASE WHEN r.orders IS NULL OR r.orders = 0 THEN '0'
                  ELSE ((r.revenue + r.orders / 2) / r.orders)::text END AS "averageOrderValue",
             r.first_at AS "firstOrderAt", r.last_at AS "lastOrderAt", r.days_since_last AS "daysSinceLastOrder",
             r.lifetime_revenue::text AS "lifetimeRevenue", r.lifetime_orders::text AS "lifetimeOrders",
             r.revenue_rank::text AS "revenueRank", r.order_rank::text AS "orderRank",
             s.one_time AS "oneTimeCustomers", s.repeat AS "repeatCustomers",
             s.distribution_2_3 AS "distribution2to3", s.distribution_4_5 AS "distribution4to5",
             s.distribution_6_10 AS "distribution6to10", s.distribution_11_plus AS "distribution11plus",
             s.top_ten_revenue AS "topTenRevenue", s.known_revenue AS "knownRevenue", g.average_days AS "averageDaysBetweenOrders"
      FROM stats s CROSS JOIN average_gap g
      LEFT JOIN ranked r ON r.revenue_rank <= $6 OR r.order_rank <= $6
      ORDER BY r.revenue_rank NULLS LAST, r.order_rank NULLS LAST
    `, [coffeeShopId, ranges.current.start, ranges.current.endExclusive, timezone, COMPLETED_ORDER_STATUS, limit]);
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
