import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { COMPLETED_ORDER_STATUS } from "../ordering/order-status.util";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { AnalyticsQueryDto, compareMetric, percentOf } from "./analytics.dto";
import { PromotionAnalyticsQueryDto } from "./analytics.dto";
import { analyticsGranularity, analyticsRanges, analyticsSeriesParts, AnalyticsRanges } from "./analytics-period";

const PROMOTION_FACTS_CTE = `
  WITH bounds AS (
    SELECT $2::date AS local_start, $4::date AS local_end,
           $2::timestamp AT TIME ZONE $5 AS previous_start,
           $3::timestamp AT TIME ZONE $5 AS current_start,
           $4::timestamp AT TIME ZONE $5 AS current_end
  ), successful_orders AS (
    SELECT o.id, o.client_id, o.status_changed_at, o.total_amount_toman, o.customer_promotion_snapshot,
           CASE WHEN o.status_changed_at < b.current_start THEN 'previous' ELSE 'current' END AS period
    FROM orders o CROSS JOIN bounds b
    WHERE o.coffee_shop_id = $1 AND o.status = $6::order_status
      AND o.status_changed_at >= b.previous_start AND o.status_changed_at < b.current_end
  ), promotion_facts AS (
    SELECT o.id AS order_id, o.client_id, o.status_changed_at, o.period,
           o.total_amount_toman AS order_value, oi.promotion_id_snapshot AS promotion_id,
           oi.promotion_name_snapshot AS promotion_name,
           COALESCE(oi.promotion_type_snapshot, oi.promotion_reward_type_snapshot) AS promotion_type,
           'ITEM'::text AS scope, SUM(oi.quantity)::bigint AS units,
           SUM(oi.original_unit_price_toman * oi.quantity)::numeric AS gross_amount,
           SUM(oi.discount_amount_toman * oi.quantity)::numeric AS discount_amount,
           SUM(oi.line_total_toman)::numeric AS net_amount,
           EXISTS (SELECT 1 FROM promotion_redemptions r
                   WHERE r.coffee_shop_id = $1 AND r.order_id = o.id AND r.promotion_id = oi.promotion_id_snapshot
                     AND r.status = 'APPLIED' AND r.coupon_id IS NOT NULL) AS is_coupon,
           CASE WHEN EXISTS (SELECT 1 FROM promotion_redemptions r
                             WHERE r.coffee_shop_id = $1 AND r.order_id = o.id AND r.promotion_id = oi.promotion_id_snapshot
                               AND r.status = 'APPLIED' AND r.coupon_id IS NOT NULL)
                THEN ord.coupon_code_snapshot ELSE NULL END AS coupon_code
    FROM successful_orders o
    JOIN orders ord ON ord.id = o.id AND ord.coffee_shop_id = $1
    JOIN order_items oi ON oi.order_id = o.id AND oi.coffee_shop_id = $1
    WHERE oi.promotion_id_snapshot IS NOT NULL AND oi.discount_amount_toman > 0
      AND (NOT EXISTS (SELECT 1 FROM promotion_redemptions r
                       WHERE r.coffee_shop_id = $1 AND r.order_id = o.id AND r.promotion_id = oi.promotion_id_snapshot)
           OR EXISTS (SELECT 1 FROM promotion_redemptions r
                      WHERE r.coffee_shop_id = $1 AND r.order_id = o.id AND r.promotion_id = oi.promotion_id_snapshot
                        AND r.status = 'APPLIED'))
    GROUP BY o.id, o.client_id, o.status_changed_at, o.period, o.total_amount_toman,
             oi.promotion_id_snapshot, oi.promotion_name_snapshot, oi.promotion_type_snapshot,
             oi.promotion_reward_type_snapshot, ord.coupon_code_snapshot
    UNION ALL
    SELECT o.id, o.client_id, o.status_changed_at, o.period, o.total_amount_toman,
           ord.order_promotion_id_snapshot, ord.order_promotion_name_snapshot,
           ord.order_promotion_reward_type_snapshot, 'ORDER'::text, 0::bigint,
           (o.total_amount_toman + ord.order_discount_toman)::numeric,
           ord.order_discount_toman::numeric, o.total_amount_toman::numeric,
           EXISTS (SELECT 1 FROM promotion_redemptions r
                   WHERE r.coffee_shop_id = $1 AND r.order_id = o.id AND r.promotion_id = ord.order_promotion_id_snapshot
                     AND r.status = 'APPLIED' AND r.coupon_id IS NOT NULL),
           CASE WHEN EXISTS (SELECT 1 FROM promotion_redemptions r
                             WHERE r.coffee_shop_id = $1 AND r.order_id = o.id AND r.promotion_id = ord.order_promotion_id_snapshot
                               AND r.status = 'APPLIED' AND r.coupon_id IS NOT NULL)
                THEN ord.coupon_code_snapshot ELSE NULL END
    FROM successful_orders o
    JOIN orders ord ON ord.id = o.id AND ord.coffee_shop_id = $1
    WHERE ord.order_promotion_id_snapshot IS NOT NULL AND ord.order_discount_toman > 0
      AND (NOT EXISTS (SELECT 1 FROM promotion_redemptions r
                       WHERE r.coffee_shop_id = $1 AND r.order_id = o.id AND r.promotion_id = ord.order_promotion_id_snapshot)
           OR EXISTS (SELECT 1 FROM promotion_redemptions r
                      WHERE r.coffee_shop_id = $1 AND r.order_id = o.id AND r.promotion_id = ord.order_promotion_id_snapshot
                        AND r.status = 'APPLIED'))
  )`;

const PROMOTION_ORDERS_CTE = `
  , promotion_orders AS (
    SELECT promotion_id, order_id, client_id, period, MAX(order_value) AS order_value,
           SUM(gross_amount) AS gross_amount, SUM(discount_amount) AS discount_amount,
           SUM(net_amount) AS net_amount, SUM(units)::bigint AS units,
           BOOL_OR(is_coupon) AS is_coupon,
           ARRAY_AGG(DISTINCT coupon_code) FILTER (WHERE is_coupon AND coupon_code IS NOT NULL) AS coupon_codes
    FROM promotion_facts GROUP BY promotion_id, order_id, client_id, period
  )`;

type PromotionRows = {
  promotionId: string; promotionName: string; currentName: string | null; historicalNames: string[];
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED"; types: string[]; scopes: string[]; activationModes: string[]; couponCodes: string[];
  currentUses: string; previousUses: string; currentCouponUses: string; previousCouponUses: string;
  currentCustomers: string; previousCustomers: string; currentUnits: string; previousUnits: string;
  currentGross: string; previousGross: string; currentDiscount: string; previousDiscount: string;
  currentNet: string; previousNet: string; currentSales: string; previousSales: string;
};
type SummaryRow = {
  period: "current" | "previous"; uses: string; couponUses: string; orders: string; customers: string;
  newCustomers: string; returningCustomers: string; units: string; gross: string; discount: string; net: string; sales: string;
};
type TrendRow = { bucket: string; orders: string; discount: string; sales: string };
type BreakdownRow = {
  dimension: "product" | "category"; key: string; productId: string | null; categoryId: string | null;
  name: string; units: string; orders: string; gross: string; discount: string; net: string;
};
type CouponRow = { couponCode: string; uses: string; customers: string; discount: string; sales: string; averageOrderValue: string; averageDiscount: string };
type CustomerConditionRow = { conditionType: string; orders: string; customers: string };
type PromotionMetricValues = {
  uses: string; ordersAffected: string; couponRedemptions: string; uniqueCustomers: string; discountedUnits: string;
  grossPromotionalValueToman: string; promotionDiscountToman: string; netPromotionalValueToman: string;
  attributedOrderValueToman: string; averageOrderValueToman: string; averageDiscountPerOrderToman: string;
  averageDiscountRatePercent: string | null;
};

const ZERO_SUMMARY = (period: "current" | "previous"): SummaryRow => ({
  period, uses: "0", couponUses: "0", orders: "0", customers: "0", newCustomers: "0", returningCustomers: "0",
  units: "0", gross: "0", discount: "0", net: "0", sales: "0",
});

const avg = (amount: string, count: string) => {
  const total = BigInt(amount), size = BigInt(count);
  return size === 0n ? "0" : ((total + size / 2n) / size).toString();
};

function promotionMetrics(row: Pick<PromotionRows, "currentUses" | "currentCouponUses" | "currentCustomers" | "currentUnits" | "currentGross" | "currentDiscount" | "currentNet" | "currentSales">, orders = row.currentUses): PromotionMetricValues {
  return {
    uses: row.currentUses, ordersAffected: orders, couponRedemptions: row.currentCouponUses,
    uniqueCustomers: row.currentCustomers, discountedUnits: row.currentUnits,
    grossPromotionalValueToman: row.currentGross, promotionDiscountToman: row.currentDiscount,
    netPromotionalValueToman: row.currentNet, attributedOrderValueToman: row.currentSales,
    averageOrderValueToman: avg(row.currentSales, orders),
    averageDiscountPerOrderToman: avg(row.currentDiscount, orders),
    averageDiscountRatePercent: BigInt(row.currentGross) === 0n ? null : percentOf(BigInt(row.currentDiscount), BigInt(row.currentGross)),
  };
}

function summaryMetrics(row: SummaryRow): PromotionMetricValues {
  return {
    uses: row.uses, ordersAffected: row.orders, couponRedemptions: row.couponUses,
    uniqueCustomers: row.customers, discountedUnits: row.units,
    grossPromotionalValueToman: row.gross, promotionDiscountToman: row.discount,
    netPromotionalValueToman: row.net, attributedOrderValueToman: row.sales,
    averageOrderValueToman: avg(row.sales, row.orders),
    averageDiscountPerOrderToman: avg(row.discount, row.orders),
    averageDiscountRatePercent: BigInt(row.gross) === 0n ? null : percentOf(BigInt(row.discount), BigInt(row.gross)),
  };
}

@Injectable()
export class PromotionAnalyticsService {
  constructor(private readonly dataSource: DataSource, private readonly subscriptions: SubscriptionsService) {}

  private ranges(timezone: string, query: AnalyticsQueryDto): AnalyticsRanges {
    if (query.period === "custom" ? !query.start || !query.end : query.start !== undefined || query.end !== undefined) {
      throw new BadRequestException("Start and end are allowed only together for a custom period");
    }
    return analyticsRanges(query.period, timezone, query.start, query.end);
  }

  private params(coffeeShopId: string, ranges: AnalyticsRanges) {
    return [coffeeShopId, ranges.previous.start, ranges.current.start, ranges.current.endExclusive, ranges.timezone, COMPLETED_ORDER_STATUS];
  }

  private async promotionRows(coffeeShopId: string, ranges: AnalyticsRanges): Promise<PromotionRows[]> {
    return this.dataSource.query<PromotionRows[]>(`${PROMOTION_FACTS_CTE}${PROMOTION_ORDERS_CTE},
      metadata AS (
        SELECT promotion_id, ARRAY_AGG(DISTINCT promotion_type) FILTER (WHERE promotion_type IS NOT NULL) AS types,
               ARRAY_AGG(DISTINCT scope) AS scopes,
               ARRAY_AGG(DISTINCT promotion_name) FILTER (WHERE promotion_name IS NOT NULL) AS historical_names,
               ARRAY_AGG(DISTINCT CASE WHEN is_coupon THEN 'COUPON' ELSE 'AUTOMATIC' END) AS activation_modes
        FROM promotion_facts GROUP BY promotion_id
      ), last_name AS (
        SELECT DISTINCT ON (promotion_id) promotion_id, promotion_name
        FROM promotion_facts WHERE promotion_name IS NOT NULL
        ORDER BY promotion_id, status_changed_at DESC
      ), stats AS (
        SELECT promotion_id,
          COUNT(*) FILTER (WHERE period = 'current')::text AS current_uses,
          COUNT(*) FILTER (WHERE period = 'previous')::text AS previous_uses,
          COUNT(*) FILTER (WHERE period = 'current' AND is_coupon)::text AS current_coupon_uses,
          COUNT(*) FILTER (WHERE period = 'previous' AND is_coupon)::text AS previous_coupon_uses,
          COUNT(DISTINCT client_id) FILTER (WHERE period = 'current')::text AS current_customers,
          COUNT(DISTINCT client_id) FILTER (WHERE period = 'previous')::text AS previous_customers,
          COALESCE(SUM(units) FILTER (WHERE period = 'current'), 0)::text AS current_units,
          COALESCE(SUM(units) FILTER (WHERE period = 'previous'), 0)::text AS previous_units,
          COALESCE(SUM(gross_amount) FILTER (WHERE period = 'current'), 0)::text AS current_gross,
          COALESCE(SUM(gross_amount) FILTER (WHERE period = 'previous'), 0)::text AS previous_gross,
          COALESCE(SUM(discount_amount) FILTER (WHERE period = 'current'), 0)::text AS current_discount,
          COALESCE(SUM(discount_amount) FILTER (WHERE period = 'previous'), 0)::text AS previous_discount,
          COALESCE(SUM(net_amount) FILTER (WHERE period = 'current'), 0)::text AS current_net,
          COALESCE(SUM(net_amount) FILTER (WHERE period = 'previous'), 0)::text AS previous_net,
          COALESCE(SUM(order_value) FILTER (WHERE period = 'current'), 0)::text AS current_sales,
          COALESCE(SUM(order_value) FILTER (WHERE period = 'previous'), 0)::text AS previous_sales
        FROM promotion_orders GROUP BY promotion_id
      ), coupon_code_stats AS (
        SELECT po.promotion_id, ARRAY_AGG(DISTINCT code.coupon_code) AS coupon_codes
        FROM promotion_orders po CROSS JOIN LATERAL UNNEST(po.coupon_codes) AS code(coupon_code)
        GROUP BY po.promotion_id
      ), ids AS (
        SELECT id AS promotion_id FROM promotions WHERE coffee_shop_id = $1
        UNION SELECT promotion_id FROM promotion_facts
      )
      SELECT ids.promotion_id AS "promotionId", COALESCE(last_name.promotion_name, p.name, 'تخفیف آرشیوشده') AS "promotionName",
        p.name AS "currentName", COALESCE(metadata.historical_names, ARRAY[]::text[]) AS "historicalNames",
        CASE WHEN p.id IS NULL OR p.deleted_at IS NOT NULL THEN 'ARCHIVED'
             WHEN p.is_active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status,
        COALESCE(metadata.types, CASE WHEN ar.rule_type IS NOT NULL THEN ARRAY[ar.rule_type::text]
          WHEN p.reward_type IS NOT NULL THEN ARRAY[p.reward_type::text] ELSE ARRAY[]::text[] END) AS types,
        COALESCE(metadata.scopes, ARRAY[CASE WHEN COALESCE(p.entire_order, false) THEN 'ORDER' ELSE 'ITEM' END]) AS scopes,
        COALESCE(metadata.activation_modes, ARRAY[CASE WHEN pc.id IS NOT NULL THEN 'COUPON' ELSE 'AUTOMATIC' END]) AS "activationModes",
        COALESCE(coupon_code_stats.coupon_codes, CASE WHEN pc.code IS NOT NULL THEN ARRAY[pc.code] ELSE ARRAY[]::text[] END) AS "couponCodes",
        COALESCE(stats.current_uses, '0') AS "currentUses", COALESCE(stats.previous_uses, '0') AS "previousUses",
        COALESCE(stats.current_coupon_uses, '0') AS "currentCouponUses", COALESCE(stats.previous_coupon_uses, '0') AS "previousCouponUses",
        COALESCE(stats.current_customers, '0') AS "currentCustomers", COALESCE(stats.previous_customers, '0') AS "previousCustomers",
        COALESCE(stats.current_units, '0') AS "currentUnits", COALESCE(stats.previous_units, '0') AS "previousUnits",
        COALESCE(stats.current_gross, '0') AS "currentGross", COALESCE(stats.previous_gross, '0') AS "previousGross",
        COALESCE(stats.current_discount, '0') AS "currentDiscount", COALESCE(stats.previous_discount, '0') AS "previousDiscount",
        COALESCE(stats.current_net, '0') AS "currentNet", COALESCE(stats.previous_net, '0') AS "previousNet",
        COALESCE(stats.current_sales, '0') AS "currentSales", COALESCE(stats.previous_sales, '0') AS "previousSales"
      FROM ids LEFT JOIN promotions p ON p.id = ids.promotion_id AND p.coffee_shop_id = $1
      LEFT JOIN promotion_coupons pc ON pc.promotion_id = p.id AND pc.coffee_shop_id = $1
      LEFT JOIN promotion_advanced_rules ar ON ar.promotion_id = p.id AND ar.coffee_shop_id = $1
      LEFT JOIN metadata ON metadata.promotion_id = ids.promotion_id
      LEFT JOIN last_name ON last_name.promotion_id = ids.promotion_id
      LEFT JOIN stats ON stats.promotion_id = ids.promotion_id
      LEFT JOIN coupon_code_stats ON coupon_code_stats.promotion_id = ids.promotion_id
      ORDER BY "promotionName"`, this.params(coffeeShopId, ranges));
  }

  private summaryRows(coffeeShopId: string, ranges: AnalyticsRanges, promotionIds: string[]): Promise<SummaryRow[]> {
    if (!promotionIds.length) return Promise.resolve([]);
    return this.dataSource.query<SummaryRow[]>(`${PROMOTION_FACTS_CTE}${PROMOTION_ORDERS_CTE},
      selected AS (SELECT * FROM promotion_facts WHERE promotion_id = ANY($7::uuid[])),
      promotion_orders_selected AS (
        SELECT promotion_id, order_id, client_id, period, MAX(order_value) AS order_value,
               SUM(gross_amount) AS gross_amount, SUM(discount_amount) AS discount_amount,
               SUM(net_amount) AS net_amount, SUM(units)::bigint AS units, BOOL_OR(is_coupon) AS is_coupon
        FROM selected GROUP BY promotion_id, order_id, client_id, period
      ), matched_orders AS (
        SELECT order_id, client_id, period, MAX(order_value) AS order_value
        FROM selected GROUP BY order_id, client_id, period
      ), order_totals AS (
        SELECT period, COUNT(*)::text AS orders, COUNT(DISTINCT client_id)::text AS customers,
               COALESCE(SUM(order_value), 0)::text AS sales FROM matched_orders GROUP BY period
      ), promo_totals AS (
        SELECT period, COUNT(*)::text AS uses, COUNT(*) FILTER (WHERE is_coupon)::text AS coupon_uses,
               COALESCE(SUM(units), 0)::text AS units, COALESCE(SUM(gross_amount), 0)::text AS gross,
               COALESCE(SUM(discount_amount), 0)::text AS discount, COALESCE(SUM(net_amount), 0)::text AS net
        FROM promotion_orders_selected GROUP BY period
      ), first_purchases AS (
        SELECT o.client_id, MIN(o.status_changed_at) AS first_at FROM orders o CROSS JOIN bounds b
        WHERE o.coffee_shop_id = $1 AND o.status = $6::order_status AND o.status_changed_at < b.current_end
        GROUP BY o.client_id
      ), customer_totals AS (
        SELECT m.period,
          COUNT(DISTINCT m.client_id) FILTER (WHERE fp.first_at >= CASE WHEN m.period = 'current' THEN b.current_start ELSE b.previous_start END
            AND fp.first_at < CASE WHEN m.period = 'current' THEN b.current_end ELSE b.current_start END)::text AS new_customers,
          COUNT(DISTINCT m.client_id) FILTER (WHERE fp.first_at < CASE WHEN m.period = 'current' THEN b.current_start ELSE b.previous_start END)::text AS returning_customers
        FROM matched_orders m JOIN first_purchases fp ON fp.client_id = m.client_id CROSS JOIN bounds b GROUP BY m.period
      )
      SELECT p.period, COALESCE(pt.uses, '0') AS uses, COALESCE(pt.coupon_uses, '0') AS "couponUses",
        COALESCE(ot.orders, '0') AS orders, COALESCE(ot.customers, '0') AS customers,
        COALESCE(ct.new_customers, '0') AS "newCustomers", COALESCE(ct.returning_customers, '0') AS "returningCustomers",
        COALESCE(pt.units, '0') AS units, COALESCE(pt.gross, '0') AS gross, COALESCE(pt.discount, '0') AS discount,
        COALESCE(pt.net, '0') AS net, COALESCE(ot.sales, '0') AS sales
      FROM (VALUES ('current'::text), ('previous'::text)) p(period)
      LEFT JOIN order_totals ot USING (period) LEFT JOIN promo_totals pt USING (period) LEFT JOIN customer_totals ct USING (period)
      ORDER BY p.period`, [...this.params(coffeeShopId, ranges), promotionIds]);
  }

  private trendRows(coffeeShopId: string, ranges: AnalyticsRanges, promotionIds: string[], granularity: ReturnType<typeof analyticsGranularity>): Promise<TrendRow[]> {
    const { slots, bucket, textBucket } = analyticsSeriesParts(granularity, "o.status_changed_at", "$5");
    return this.dataSource.query<TrendRow[]>(`${PROMOTION_FACTS_CTE}${PROMOTION_ORDERS_CTE},
      selected AS (SELECT * FROM promotion_facts WHERE promotion_id = ANY($7::uuid[])),
      matched_orders AS (
        SELECT o.id, o.total_amount_toman, o.status_changed_at FROM successful_orders o
        WHERE o.period = 'current' AND EXISTS (SELECT 1 FROM selected f WHERE f.order_id = o.id AND f.period = 'current')
      ), slots AS (${slots}), order_totals AS (
        SELECT ${bucket} AS bucket, COUNT(*)::text AS orders, SUM(o.total_amount_toman)::text AS sales
        FROM matched_orders o CROSS JOIN bounds b GROUP BY 1
      ), promotion_totals AS (
        SELECT ${bucket} AS bucket, SUM(po.discount_amount)::text AS discount
        FROM promotion_orders po JOIN successful_orders o ON o.id = po.order_id
        CROSS JOIN bounds b WHERE po.promotion_id = ANY($7::uuid[]) AND po.period = 'current' GROUP BY 1
      )
      SELECT ${textBucket} AS bucket, COALESCE(ot.orders, '0') AS orders,
             COALESCE(pt.discount, '0') AS discount, COALESCE(ot.sales, '0') AS sales
      FROM slots s LEFT JOIN order_totals ot ON ot.bucket = s.bucket
      LEFT JOIN promotion_totals pt ON pt.bucket = s.bucket ORDER BY s.bucket`, [...this.params(coffeeShopId, ranges), promotionIds]);
  }

  async overview(coffeeShopId: string, timezone: string, query: PromotionAnalyticsQueryDto) {
    await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.Analytics);
    const ranges = this.ranges(timezone, query);
    let rows = await this.promotionRows(coffeeShopId, ranges);
    if (query.status) rows = rows.filter((row) => row.status === query.status);
    if (query.activation) rows = rows.filter((row) => row.activationModes.includes(query.activation!));
    if (query.promotionType) rows = rows.filter((row) => row.types.includes(query.promotionType!));
    const sortValue = (row: PromotionRows) => {
      if (query.sortBy === "discount") return BigInt(row.currentDiscount);
      if (query.sortBy === "attributedSales") return BigInt(row.currentSales);
      if (query.sortBy === "averageOrderValue") return BigInt(avg(row.currentSales, row.currentUses));
      return BigInt(row.currentUses);
    };
    rows.sort((a, b) => {
      const left = sortValue(a), right = sortValue(b);
      return left === right ? a.promotionName.localeCompare(b.promotionName) : left > right ? -1 : 1;
    });
    const page = Math.max(1, query.page ?? 1), pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const promotionIds = rows.map((row) => row.promotionId);
    const [summary, trends] = await Promise.all([
      this.summaryRows(coffeeShopId, ranges, promotionIds),
      this.trendRows(coffeeShopId, ranges, promotionIds, analyticsGranularity(ranges.current)),
    ]);
    const current = summary.find((row) => row.period === "current") ?? ZERO_SUMMARY("current");
    const previous = summary.find((row) => row.period === "previous") ?? ZERO_SUMMARY("previous");
    const valueMetric = (field: "uses" | "orders" | "couponUses" | "customers" | "newCustomers" | "returningCustomers" | "units" | "gross" | "discount" | "net" | "sales") => compareMetric(BigInt(current[field]), BigInt(previous[field]));
    const currentMetrics = summaryMetrics(current), previousMetrics = summaryMetrics(previous);
    const metricComparisons = {
      uses: valueMetric("uses"), ordersWithPromotion: valueMetric("orders"), uniqueCustomers: valueMetric("customers"),
      newCustomers: valueMetric("newCustomers"), returningCustomers: valueMetric("returningCustomers"), couponRedemptions: valueMetric("couponUses"),
      discountedUnits: valueMetric("units"), grossPromotionalValueToman: valueMetric("gross"),
      promotionDiscountToman: valueMetric("discount"), netPromotionalValueToman: valueMetric("net"),
      attributedOrderValueToman: valueMetric("sales"),
      averageOrderValueToman: compareMetric(BigInt(currentMetrics.averageOrderValueToman), BigInt(previousMetrics.averageOrderValueToman)),
      averageDiscountPerOrderToman: compareMetric(BigInt(currentMetrics.averageDiscountPerOrderToman), BigInt(previousMetrics.averageDiscountPerOrderToman)),
    };
    const publicRow = (row: PromotionRows) => ({
      promotionId: row.promotionId, promotionName: row.promotionName, currentName: row.currentName,
      historicalNames: row.historicalNames, status: row.status, types: row.types, scopes: row.scopes,
      activationModes: row.activationModes, couponCodes: row.couponCodes,
      metrics: { current: promotionMetrics(row), previous: promotionMetrics({
        currentUses: row.previousUses, currentCouponUses: row.previousCouponUses, currentCustomers: row.previousCustomers,
        currentUnits: row.previousUnits, currentGross: row.previousGross, currentDiscount: row.previousDiscount,
        currentNet: row.previousNet, currentSales: row.previousSales,
      }, row.previousUses) },
    });
    const ranked = (field: "currentUses" | "currentDiscount" | "currentSales") => rows.filter((row) => BigInt(row[field]) > BigInt(0)).sort((a, b) => BigInt(a[field]) === BigInt(b[field]) ? a.promotionName.localeCompare(b.promotionName) : BigInt(a[field]) > BigInt(b[field]) ? -1 : 1).slice(0, 5).map(publicRow);
    const granularity = analyticsGranularity(ranges.current);
    return {
      period: query.period, timezone, current: ranges.current, previous: ranges.previous, granularity,
      filters: { activation: query.activation ?? null, promotionType: query.promotionType ?? null, status: query.status ?? null },
      metrics: metricComparisons,
      currentTotals: currentMetrics,
      series: {
        orders: { key: "orders", label: "سفارش‌های دارای تخفیف", points: trends.map((row) => ({ bucket: row.bucket, label: row.bucket, value: row.orders })) },
        discountToman: { key: "discountToman", label: "مبلغ تخفیف", points: trends.map((row) => ({ bucket: row.bucket, label: row.bucket, value: row.discount })) },
        attributedOrderValueToman: { key: "attributedOrderValueToman", label: "ارزش سفارش‌های مرتبط", points: trends.map((row) => ({ bucket: row.bucket, label: row.bucket, value: row.sales })) },
      },
      topPromotions: { byUses: ranked("currentUses"), byDiscount: ranked("currentDiscount"), byAttributedOrderValue: ranked("currentSales") },
      promotions: rows.slice((page - 1) * pageSize, page * pageSize).map(publicRow),
      pagination: { page, pageSize, total: rows.length, hasMore: page * pageSize < rows.length },
    };
  }

  async detail(coffeeShopId: string, timezone: string, promotionId: string, query: AnalyticsQueryDto) {
    await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.Analytics);
    const ranges = this.ranges(timezone, query);
    const row = (await this.promotionRows(coffeeShopId, ranges)).find((candidate) => candidate.promotionId === promotionId);
    if (!row) throw new NotFoundException("Promotion analytics not found");
    const [summary, trends, breakdowns, coupons, customerConditions] = await Promise.all([
      this.summaryRows(coffeeShopId, ranges, [promotionId]),
      this.trendRows(coffeeShopId, ranges, [promotionId], analyticsGranularity(ranges.current)),
      this.dataSource.query<BreakdownRow[]>(`${PROMOTION_FACTS_CTE}
        SELECT CASE WHEN GROUPING(oi.menu_item_id) = 0 THEN 'product' ELSE 'category' END AS dimension,
          CASE WHEN GROUPING(oi.menu_item_id) = 0 THEN COALESCE(oi.menu_item_id::text, 'snapshot:' || oi.item_name)
               ELSE COALESCE(oi.category_id_snapshot::text, 'snapshot:' || COALESCE(oi.category_name_snapshot, 'بدون دسته‌بندی')) END AS key,
          CASE WHEN GROUPING(oi.menu_item_id) = 0 THEN oi.menu_item_id END AS "productId",
          CASE WHEN GROUPING(oi.menu_item_id) = 1 THEN oi.category_id_snapshot END AS "categoryId",
          CASE WHEN GROUPING(oi.menu_item_id) = 0 THEN oi.item_name ELSE COALESCE(oi.category_name_snapshot, 'بدون دسته‌بندی') END AS name,
          SUM(oi.quantity)::text AS units, COUNT(DISTINCT o.id)::text AS orders,
          SUM(oi.original_unit_price_toman * oi.quantity)::text AS gross,
          SUM(oi.discount_amount_toman * oi.quantity)::text AS discount,
          SUM(oi.line_total_toman)::text AS net
        FROM successful_orders o JOIN order_items oi ON oi.order_id = o.id AND oi.coffee_shop_id = $1
        WHERE o.period = 'current' AND oi.promotion_id_snapshot = $7::uuid AND oi.discount_amount_toman > 0
          AND EXISTS (SELECT 1 FROM promotion_facts f WHERE f.order_id = o.id AND f.promotion_id = $7::uuid)
        GROUP BY GROUPING SETS ((oi.menu_item_id, oi.item_name), (oi.category_id_snapshot, oi.category_name_snapshot))
        ORDER BY dimension, SUM(oi.original_unit_price_toman * oi.quantity) DESC`, [...this.params(coffeeShopId, ranges), promotionId]),
      this.dataSource.query<CouponRow[]>(`${PROMOTION_FACTS_CTE}${PROMOTION_ORDERS_CTE},
        coupon_facts AS (
          SELECT po.order_id, po.client_id, po.discount_amount, po.order_value, code.coupon_code
          FROM promotion_orders po CROSS JOIN LATERAL UNNEST(po.coupon_codes) code(coupon_code)
          WHERE po.promotion_id = $7::uuid AND po.period = 'current' AND po.is_coupon
        )
        SELECT coupon_code AS "couponCode", COUNT(DISTINCT order_id)::text AS uses,
          COUNT(DISTINCT client_id)::text AS customers, SUM(discount_amount)::text AS discount,
          SUM(order_value)::text AS sales,
          ROUND(SUM(order_value) / COUNT(DISTINCT order_id))::text AS "averageOrderValue",
          ROUND(SUM(discount_amount) / COUNT(DISTINCT order_id))::text AS "averageDiscount"
        FROM coupon_facts GROUP BY coupon_code ORDER BY coupon_code`, [...this.params(coffeeShopId, ranges), promotionId]),
      this.dataSource.query<CustomerConditionRow[]>(`${PROMOTION_FACTS_CTE}
        SELECT condition->>'type' AS "conditionType", COUNT(DISTINCT o.id)::text AS orders,
          COUNT(DISTINCT o.client_id)::text AS customers
        FROM successful_orders o
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.customer_promotion_snapshot, '[]'::jsonb)) AS promotion(entry)
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(promotion.entry->'conditions', '[]'::jsonb)) AS applied(condition)
        WHERE o.period = 'current' AND promotion.entry->>'promotionId' = $7::text
          AND EXISTS (SELECT 1 FROM promotion_facts f WHERE f.order_id = o.id AND f.promotion_id = $7::uuid)
        GROUP BY condition->>'type' ORDER BY condition->>'type'`, [...this.params(coffeeShopId, ranges), promotionId]),
    ]);
    const current = summary.find((item) => item.period === "current") ?? ZERO_SUMMARY("current");
    const previous = summary.find((item) => item.period === "previous") ?? ZERO_SUMMARY("previous");
    const currentMetrics = summaryMetrics(current), previousMetrics = summaryMetrics(previous);
    const publicRow = {
      promotionId: row.promotionId, promotionName: row.promotionName, currentName: row.currentName,
      historicalNames: row.historicalNames, status: row.status, types: row.types, scopes: row.scopes,
      activationModes: row.activationModes, couponCodes: row.couponCodes,
    };
    return {
      period: query.period, timezone, current: ranges.current, previous: ranges.previous,
      granularity: analyticsGranularity(ranges.current), promotion: publicRow,
      metrics: {
        uses: compareMetric(BigInt(current.uses), BigInt(previous.uses)),
        ordersWithPromotion: compareMetric(BigInt(current.orders), BigInt(previous.orders)),
        uniqueCustomers: compareMetric(BigInt(current.customers), BigInt(previous.customers)),
        newCustomers: compareMetric(BigInt(current.newCustomers), BigInt(previous.newCustomers)),
        returningCustomers: compareMetric(BigInt(current.returningCustomers), BigInt(previous.returningCustomers)),
        couponRedemptions: compareMetric(BigInt(current.couponUses), BigInt(previous.couponUses)),
        discountedUnits: compareMetric(BigInt(current.units), BigInt(previous.units)),
        grossPromotionalValueToman: compareMetric(BigInt(current.gross), BigInt(previous.gross)),
        promotionDiscountToman: compareMetric(BigInt(current.discount), BigInt(previous.discount)),
        netPromotionalValueToman: compareMetric(BigInt(current.net), BigInt(previous.net)),
        attributedOrderValueToman: compareMetric(BigInt(current.sales), BigInt(previous.sales)),
        averageOrderValueToman: compareMetric(BigInt(currentMetrics.averageOrderValueToman), BigInt(previousMetrics.averageOrderValueToman)),
        averageDiscountPerOrderToman: compareMetric(BigInt(currentMetrics.averageDiscountPerOrderToman), BigInt(previousMetrics.averageDiscountPerOrderToman)),
        averageDiscountRatePercent: { value: currentMetrics.averageDiscountRatePercent, previousValue: previousMetrics.averageDiscountRatePercent },
      },
      series: {
        orders: { key: "orders", label: "سفارش‌های دارای تخفیف", points: trends.map((item) => ({ bucket: item.bucket, label: item.bucket, value: item.orders })) },
        discountToman: { key: "discountToman", label: "مبلغ تخفیف", points: trends.map((item) => ({ bucket: item.bucket, label: item.bucket, value: item.discount })) },
        attributedOrderValueToman: { key: "attributedOrderValueToman", label: "ارزش سفارش‌های مرتبط", points: trends.map((item) => ({ bucket: item.bucket, label: item.bucket, value: item.sales })) },
      },
      breakdowns: {
        products: breakdowns.filter((item) => item.dimension === "product"),
        categories: breakdowns.filter((item) => item.dimension === "category"),
      },
      coupons, customerConditions,
      usage: { definition: "one use is one delivered order containing a promotion allocation; repeated item allocations in one order remain one use", applicationCountAvailable: false },
    };
  }
}
