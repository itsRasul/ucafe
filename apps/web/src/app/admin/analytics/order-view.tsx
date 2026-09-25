"use client";

import { useState } from "react";
import { formatJalaliDate } from "../../jalali-date";

type Metric = { value: string | null; previousValue: string | null; change: string | null; changePercent: string | null };
type Point = { bucket: string; label: string; value: string };
type Series = { key: string; label: string; points: Point[] };
type DimensionRow = {
  totalOrders: Metric; completedOrders: Metric; revenueToman: Metric; averageOrderValueToman: Metric;
  orderSharePercent: string; previousOrderSharePercent: string; completedOrderSharePercent: string;
  previousCompletedOrderSharePercent: string; revenueSharePercent: string; previousRevenueSharePercent: string;
};
export type OrderAnalytics = {
  timezone: string;
  granularity: "hour" | "day" | "week" | "month" | "year";
  metrics: {
    totalOrdersCreated: Metric; completedOrders: Metric; cancelledOrders: Metric;
    completionRate: Metric; cancellationRate: Metric; cancelledOrderValueToman: Metric; averageItemsPerOrder: Metric;
  };
  statusBreakdown: Array<{ status: string; orderCount: string; sharePercent: string }>;
  outcomeTrend: Series[];
  orderSizeDistribution: Array<{ key: string; orders: string }>;
  fulfillment: Array<DimensionRow & { fulfillmentType: string }>;
  sources: Array<DimensionRow & { source: string }>;
};

const fa = new Intl.NumberFormat("fa-IR");
const number = (value: string) => fa.format(BigInt(value));
const decimal = (value: string) => {
  const [whole, fraction] = value.split(".");
  return fraction === undefined ? number(value) : `${number(whole!)}٫${number(fraction)}`;
};
const toman = (value: string) => `${number(value)} تومان`;
const percent = (value: string | null) => value === null ? "قابل محاسبه نیست" : `${decimal(value)}٪`;
const statuses: Record<string, string> = {
  UNDER_REVIEW: "در انتظار بررسی", PREPARING: "در حال آماده‌سازی", READY: "آماده تحویل",
  OUT_FOR_DELIVERY: "در مسیر ارسال", DELIVERED: "تکمیل‌شده", CANCELED: "لغوشده",
};
const fulfillmentNames: Record<string, string> = { PICKUP: "تحویل در کافه", COURIER: "ارسال با پیک", UNKNOWN: "نامشخص" };
const sourceNames: Record<string, string> = { PUBLIC_CLIENT: "ثبت آنلاین توسط مشتری", UNKNOWN: "نامشخص (سفارش قدیمی)" };
const itemBuckets: Record<string, string> = {
  zero: "بدون آیتم", one: "۱ آیتم", two: "۲ آیتم", threeToFour: "۳ تا ۴ آیتم", fiveToSeven: "۵ تا ۷ آیتم", eightPlus: "۸ آیتم یا بیشتر",
};

function Kpi({ title, metric, format, rate = false }: { title: string; metric: Metric; format: (value: string) => string; rate?: boolean }) {
  const direction = metric.change === null ? "unknown" : metric.change.startsWith("-") ? "down" : metric.change === "0.00" || metric.change === "0" ? "flat" : "up";
  const comparison = rate && metric.change !== null
    ? `${metric.change.startsWith("-") || metric.change === "0.00" ? "" : "+"}${decimal(metric.change)} واحد درصد`
    : metric.changePercent === null ? "مقایسه در دسترس نیست" : `${metric.changePercent.startsWith("-") || metric.changePercent === "0.00" ? "" : "+"}${percent(metric.changePercent)}`;
  return <article className="analytics-kpi"><span>{title}</span><strong>{metric.value === null ? "قابل محاسبه نیست" : format(metric.value)}</strong><div><span className={`analytics-change ${direction}`}>{comparison}</span><small>دوره قبل: {metric.previousValue === null ? "قابل محاسبه نیست" : format(metric.previousValue)}</small></div></article>;
}

function bucketLabel(bucket: string, granularity: OrderAnalytics["granularity"], timezone: string) {
  if (granularity === "hour") return new Intl.DateTimeFormat("fa-IR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(bucket));
  return formatJalaliDate(bucket.slice(0, 10));
}

function OutcomeTrend({ data }: { data: OrderAnalytics }) {
  const [active, setActive] = useState(0);
  const [completed, cancelled] = data.outcomeTrend;
  const points = completed?.points ?? [];
  const peak = data.outcomeTrend.reduce((largest, series) => series.points.reduce((value, point) => BigInt(point.value) > value ? BigInt(point.value) : value, largest), BigInt(0));
  const width = Math.max(680, points.length * 31 + 58);
  const step = points.length < 2 ? 0 : (width - 70) / (points.length - 1);
  const coordinates = (series: Series) => series.points.map((point, index) => ({
    x: 35 + step * index,
    y: 160 - Number(BigInt(point.value) * BigInt(116) / (peak || BigInt(1))),
  }));
  const selected = points[Math.min(active, points.length - 1)];
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  return <section className="analytics-trend order-outcome-trend" aria-label="روند وضعیت سفارش‌ها">
    <header><div><h2>روند تکمیل و لغو</h2><p>بر اساس زمان آخرین تغییر وضعیت نهایی</p></div>{selected && <div className="analytics-chart-reading"><strong>{bucketLabel(selected.bucket, data.granularity, data.timezone)}</strong><span>تکمیل: {number(completed?.points[active]?.value ?? "0")} · لغو: {number(cancelled?.points[active]?.value ?? "0")}</span></div>}</header>
    <div className="order-trend-legend"><span className="completed-key">تکمیل‌شده</span><span className="cancelled-key">لغوشده</span></div>
    <div className="analytics-chart-scroll" tabIndex={0} aria-label="نمودار روند وضعیت‌ها؛ برای دیدن همه بازه‌ها پیمایش کنید">
      <svg width={width} height="220" viewBox={`0 0 ${width} 220`} role="img" aria-label={`روند تکمیل و لغو در ${points.length} بازه`}>
        {[44, 102, 160].map((y) => <line key={y} className="analytics-grid-line" x1="35" y1={y} x2={width - 35} y2={y} />)}
        {data.outcomeTrend.map((series, seriesIndex) => {
          const xy = coordinates(series);
          return <g key={series.key} className={seriesIndex === 0 ? "completed-series" : "cancelled-series"}>
            <polyline className="analytics-line" points={xy.map(({ x, y }) => `${x},${y}`).join(" ")} />
            {series.points.map((point, index) => <g key={point.bucket}>
              <circle className={`analytics-dot ${active === index ? "active" : ""}`} cx={xy[index]!.x} cy={xy[index]!.y} r={active === index ? 5 : 3.5} tabIndex={0} role="button" aria-label={`${statuses[series.key] ?? series.key}، ${bucketLabel(point.bucket, data.granularity, data.timezone)}: ${number(point.value)}`} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(index); } }}><title>{statuses[series.key] ?? series.key}: {number(point.value)}</title></circle>
              {seriesIndex === 0 && (index % labelEvery === 0 || index === points.length - 1) && <text className="analytics-axis-label" x={xy[index]!.x} y="198" textAnchor="middle">{bucketLabel(point.bucket, data.granularity, data.timezone)}</text>}
            </g>)}
          </g>;
        })}
      </svg>
    </div>
  </section>;
}

function Breakdown({ data }: { data: OrderAnalytics }) {
  const max = data.statusBreakdown.reduce((largest, row) => BigInt(row.orderCount) > largest ? BigInt(row.orderCount) : largest, BigInt(0));
  return <div className="order-status-list">{data.statusBreakdown.map((row) => <div className="order-status-row" key={row.status}>
    <span>{statuses[row.status] ?? row.status}</span><div className="order-status-track"><i style={{ width: max === BigInt(0) ? "0%" : `${Number(BigInt(row.orderCount) * BigInt(10000) / max) / 100}%` }} /></div>
    <strong>{number(row.orderCount)}</strong><small>{percent(row.sharePercent)}</small>
  </div>)}</div>;
}

export function OrderView({ data }: { data: OrderAnalytics }) {
  const hasCreated = data.metrics.totalOrdersCreated.value !== "0";
  return <div className="analytics-results order-analytics">
    <p className="analytics-time-intro">سفارش‌های ثبت‌شده بر اساس زمان ایجاد و نتایج نهایی بر اساس زمان تغییر وضعیت شمارش می‌شوند.</p>
    <div className="analytics-kpis order-kpis">
      <Kpi title="کل سفارش‌های ثبت‌شده" metric={data.metrics.totalOrdersCreated} format={number} />
      <Kpi title="سفارش‌های تکمیل‌شده" metric={data.metrics.completedOrders} format={number} />
      <Kpi title="نرخ تکمیل" metric={data.metrics.completionRate} format={percent} rate />
      <Kpi title="نرخ لغو" metric={data.metrics.cancellationRate} format={percent} rate />
      <Kpi title="میانگین آیتم در سفارش تکمیل‌شده" metric={data.metrics.averageItemsPerOrder} format={decimal} />
    </div>
    {!hasCreated && <div className="analytics-empty"><strong>در این بازه سفارشی ثبت نشده است.</strong><p>با ثبت و پردازش سفارش، وضعیت‌ها و روش‌های تحویل اینجا نمایش داده می‌شوند.</p></div>}
    <div className="order-two-column">
      <section className="analytics-time-panel"><h2>وضعیت سفارش‌های ایجادشده در بازه</h2><p>وضعیت فعلی هر سفارش، حتی اگر پس از پایان بازه تغییر کرده باشد.</p><Breakdown data={data} /></section>
      <section className="analytics-time-panel"><h2>ارزش سفارش‌های لغوشده</h2><p>مبلغ ثبت‌شده برای سفارش‌های لغوشده؛ این مبلغ، درآمد ازدست‌رفته یا وجه پرداخت‌شده نیست.</p><strong className="order-cancel-value">{toman(data.metrics.cancelledOrderValueToman.value ?? "0")}</strong><small>دوره قبل: {toman(data.metrics.cancelledOrderValueToman.previousValue ?? "0")}</small></section>
    </div>
    <OutcomeTrend data={data} />
    <div className="order-two-column">
      <section className="analytics-time-panel"><h2>اندازه سبد سفارش</h2><p>تعداد آیتم بر مبنای جمع quantity سفارش‌های تکمیل‌شده</p><div className="order-size-list">{data.orderSizeDistribution.map((row) => <div key={row.key}><span>{itemBuckets[row.key] ?? row.key}</span><strong>{number(row.orders)}</strong></div>)}</div></section>
      <section className="analytics-time-panel"><h2>نوع تحویل</h2><p>تعداد سفارش‌های ایجادشده جدا از سفارش‌های تکمیل‌شده نمایش داده می‌شود.</p><div className="analytics-table-scroll" tabIndex={0}><table className="analytics-table"><thead><tr><th>نوع تحویل</th><th>ثبت‌شده</th><th>تکمیل‌شده</th><th>سهم ثبت‌شده</th><th>سهم تکمیل‌شده</th><th>درآمد</th><th>سهم درآمد</th><th>میانگین مبلغ</th></tr></thead><tbody>{data.fulfillment.map((row) => <tr key={row.fulfillmentType}><td>{fulfillmentNames[row.fulfillmentType] ?? row.fulfillmentType}</td><td>{number(row.totalOrders.value ?? "0")}</td><td>{number(row.completedOrders.value ?? "0")}</td><td>{percent(row.orderSharePercent)}</td><td>{percent(row.completedOrderSharePercent)}</td><td>{toman(row.revenueToman.value ?? "0")}</td><td>{percent(row.revenueSharePercent)}</td><td>{toman(row.averageOrderValueToman.value ?? "0")}</td></tr>)}</tbody></table></div></section>
    </div>
    <section className="analytics-time-panel"><h2>عملکرد منبع سفارش</h2><p>منبع فعلی فقط ثبت آنلاین توسط مشتری را از داده‌های قدیمی بدون منبع جدا می‌کند؛ وب‌سایت، QR و انتساب بازاریابی ثبت نمی‌شوند.</p>{data.sources.length === 0 ? <p className="analytics-table-empty">برای این بازه داده‌ای از منبع سفارش وجود ندارد.</p> : <div className="analytics-table-scroll" tabIndex={0}><table className="analytics-table"><thead><tr><th>منبع</th><th>سفارش ثبت‌شده</th><th>تکمیل‌شده</th><th>سهم ثبت‌شده</th><th>سهم تکمیل‌شده</th><th>درآمد</th><th>سهم درآمد</th><th>میانگین مبلغ</th></tr></thead><tbody>{data.sources.map((row) => <tr key={row.source}><td>{sourceNames[row.source] ?? row.source}</td><td>{number(row.totalOrders.value ?? "0")}</td><td>{number(row.completedOrders.value ?? "0")}</td><td>{percent(row.orderSharePercent)}</td><td>{percent(row.completedOrderSharePercent)}</td><td>{toman(row.revenueToman.value ?? "0")}</td><td>{percent(row.revenueSharePercent)}</td><td>{toman(row.averageOrderValueToman.value ?? "0")}</td></tr>)}</tbody></table></div>}</section>
    <p className="analytics-note">مدل سفارش وضعیت «ردشده» ندارد. نرخ تکمیل و لغو از سفارش‌های نهایی‌شده در بازه محاسبه می‌شود؛ سفارش‌های فعال در مخرج قرار نمی‌گیرند.</p>
  </div>;
}
