import { BadRequestException, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CANCELLED_ORDER_STATUS, COMPLETED_ORDER_STATUS } from "../ordering/order-status.util";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { AnalyticsQueryDto, compareMetric } from "./analytics.dto";
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

  private series(coffeeShopId: string, ranges: AnalyticsRanges, granularity: AnalyticsGranularity): Promise<SeriesRow[]> {
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
    const textBucket = granularity === "hour" ? `to_char(s.bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` : `s.bucket::text`;
    return this.dataSource.query<SeriesRow[]>(`
      WITH bounds AS (
        SELECT $2::date AS local_start, $3::date AS local_end,
               $2::timestamp AT TIME ZONE $5 AS current_start,
               $3::timestamp AT TIME ZONE $5 AS current_end
      ), slots AS (${slots[granularity]}), totals AS (
        SELECT ${bucket[granularity]} AS bucket,
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
}
