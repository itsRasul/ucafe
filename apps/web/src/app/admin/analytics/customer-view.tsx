"use client";

import { useState } from "react";
import { formatJalaliDate } from "../../jalali-date";

type Metric = { value: string; previousValue: string; change: string; changePercent: string | null };
type Point = { bucket: string; label: string; value: string };
type Series = { key: string; label: string; points: Point[] };
type CustomerRow = {
  customerId: string; displayName: string; revenueToman: string; orderCount: string; averageOrderValueToman: string;
  firstOrderAt: string; lastOrderAt: string; daysSinceLastOrder: string; lifetimeRevenueToman: string; lifetimeOrderCount: string;
};
export type CustomerAnalytics = {
  timezone: string; granularity: "hour" | "day" | "week" | "month" | "year";
  metrics: {
    uniqueCustomers: Metric; newCustomers: Metric; returningCustomers: Metric; returningCustomerRate: Metric;
    averageRevenuePerCustomerToman: Metric; averageOrdersPerCustomer: Metric; knownCustomerRevenueToman: Metric;
  };
  newVsReturning: Array<{ key: string; label: string; customers: string; customerSharePercent: string; revenueToman: string; revenueSharePercent: string }>;
  coverage: { identifiedRevenuePercent: string | null; identifiedOrderPercent: string | null; anonymousRevenueToman: string; anonymousOrders: string };
  behavior: {
    averageDaysBetweenOrders: string | null; oneTimeCustomers: string; repeatCustomers: string;
    orderCountDistribution: Array<{ key: string; label: string; customers: string }>;
    topTenRevenueSharePercent: string;
  };
  trends: { uniqueCustomers: Series; newCustomers: Series; returningCustomers: Series };
  rankings: { byRevenue: CustomerRow[]; byOrderCount: CustomerRow[] };
};

const fa = new Intl.NumberFormat("fa-IR");
const number = (value: string) => fa.format(BigInt(value));
const decimal = (value: string) => {
  const [whole, fraction] = value.split(".");
  return fraction === undefined ? number(value) : `${number(whole!)}٫${number(fraction)}`;
};
const toman = (value: string) => `${number(value)} تومان`;
const percent = (value: string | null) => value === null ? "در دسترس نیست" : `${decimal(value)}٪`;
const direction = (value: string) => value.startsWith("-") ? "down" : value === "0" || value === "0.00" ? "flat" : "up";

function Comparison({ metric }: { metric: Metric }) {
  return <span className={`analytics-change ${direction(metric.change)}`}>{metric.changePercent === null ? "مقایسه در دسترس نیست" : `${metric.changePercent.startsWith("-") || metric.changePercent === "0.00" ? "" : "+"}${percent(metric.changePercent)}`}</span>;
}

function RateDelta({ metric }: { metric: Metric }) {
  return <span className={`analytics-change ${direction(metric.change)}`}>{metric.change.startsWith("-") || metric.change === "0.00" ? "" : "+"}{percent(metric.change)} واحد درصد</span>;
}

function Kpi({ title, metric, format, main = false }: { title: string; metric: Metric; format: (value: string) => string; main?: boolean }) {
  return <article className={`analytics-kpi${main ? " main" : ""}`}><span>{title}</span><strong>{format(metric.value)}</strong><div><Comparison metric={metric} /><small>دوره قبل: {format(metric.previousValue)}</small></div></article>;
}

function bucketLabel(bucket: string, granularity: CustomerAnalytics["granularity"], timezone: string) {
  if (granularity === "hour") return new Intl.DateTimeFormat("fa-IR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(bucket));
  return formatJalaliDate(bucket.slice(0, 10));
}

function CustomerTrend({ title, description, series, granularity, timezone }: { title: string; description: string; series: Series; granularity: CustomerAnalytics["granularity"]; timezone: string }) {
  const [active, setActive] = useState(0);
  const points = series.points;
  const peak = points.reduce((largest, point) => BigInt(point.value) > largest ? BigInt(point.value) : largest, BigInt(0));
  const width = Math.max(680, points.length * 31 + 58);
  const step = points.length < 2 ? 0 : (width - 70) / (points.length - 1);
  const xy = points.map((point, index) => ({ x: 35 + step * index, y: 160 - Number(BigInt(point.value) * BigInt(116) / (peak || BigInt(1))) }));
  const selected = points[Math.min(active, points.length - 1)];
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  return <section className="analytics-trend" aria-label={title}>
    <header><div><h2>{title}</h2><p>{description}</p></div>{selected && <div className="analytics-chart-reading"><strong>{number(selected.value)}</strong><span>{bucketLabel(selected.bucket, granularity, timezone)}</span></div>}</header>
    <div className="analytics-chart-scroll" tabIndex={0} aria-label={`نمودار ${title}؛ برای دیدن همه بازه‌ها پیمایش کنید`}>
      <svg width={width} height="220" viewBox={`0 0 ${width} 220`} role="img" aria-label={`${title} در ${points.length} بازه`}>
        {[44, 102, 160].map((y) => <line key={y} className="analytics-grid-line" x1="35" y1={y} x2={width - 35} y2={y} />)}
        <polyline className="analytics-line" points={xy.map(({ x, y }) => `${x},${y}`).join(" ")} />
        {points.map((point, index) => <g key={point.bucket}>
          <circle className={`analytics-dot ${active === index ? "active" : ""}`} cx={xy[index]!.x} cy={xy[index]!.y} r={active === index ? 5.5 : 4} tabIndex={0} role="button" aria-label={`${bucketLabel(point.bucket, granularity, timezone)}: ${number(point.value)}`} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(index); } }}><title>{bucketLabel(point.bucket, granularity, timezone)}: {number(point.value)}</title></circle>
          {(index % labelEvery === 0 || index === points.length - 1) && <text className="analytics-axis-label" x={xy[index]!.x} y="198" textAnchor="middle">{bucketLabel(point.bucket, granularity, timezone)}</text>}
        </g>)}
      </svg>
    </div>
  </section>;
}

function CustomerRankings({ data, timezone }: { data: CustomerAnalytics; timezone: string }) {
  const [mode, setMode] = useState<"revenue" | "orders">("revenue");
  const rows = mode === "revenue" ? data.rankings.byRevenue : data.rankings.byOrderCount;
  const date = (value: string) => new Intl.DateTimeFormat("fa-IR", { timeZone: timezone, dateStyle: "medium" }).format(new Date(value));
  return <section className="customer-panel">
    <header className="customer-section-heading"><div><h2>مشتریان برتر</h2><p>رتبه‌بندی بر اساس همین بازه؛ سابقه عمر هر مشتری جدا نمایش داده شده است.</p></div><div className="customer-ranking-tabs"><button type="button" aria-pressed={mode === "revenue"} onClick={() => setMode("revenue")}>بیشترین درآمد</button><button type="button" aria-pressed={mode === "orders"} onClick={() => setMode("orders")}>بیشترین سفارش</button></div></header>
    {rows.length === 0 ? <p className="analytics-empty">در این بازه خرید تکمیل‌شده‌ای از مشتریان ثبت نشده است.</p> : <div className="customer-table-scroll"><table className="customer-table"><thead><tr><th>مشتری</th><th>سفارش بازه</th><th>درآمد بازه</th><th>میانگین سفارش</th><th>آخرین خرید</th></tr></thead><tbody>{rows.map((row) => <tr key={row.customerId}>
      <td><strong>{row.displayName}</strong><small>اولین خرید: {date(row.firstOrderAt)} · عمر: {number(row.lifetimeOrderCount)} سفارش / {toman(row.lifetimeRevenueToman)}</small></td>
      <td>{number(row.orderCount)}</td><td>{toman(row.revenueToman)}</td><td>{toman(row.averageOrderValueToman)}</td>
      <td>{date(row.lastOrderAt)}<small>{number(row.daysSinceLastOrder)} روز از آخرین خرید</small></td>
    </tr>)}</tbody></table></div>}
  </section>;
}

export function CustomerView({ data }: { data: CustomerAnalytics }) {
  const newCustomer = data.newVsReturning[0]!;
  const returning = data.newVsReturning[1]!;
  return <div className="analytics-results customer-results">
    <div className="analytics-kpis customer-kpis">
      <Kpi title="مشتریان" metric={data.metrics.uniqueCustomers} format={number} main />
      <Kpi title="مشتریان جدید" metric={data.metrics.newCustomers} format={number} />
      <Kpi title="مشتریان بازگشتی" metric={data.metrics.returningCustomers} format={number} />
      <Kpi title="میانگین درآمد هر مشتری" metric={data.metrics.averageRevenuePerCustomerToman} format={toman} />
      <Kpi title="میانگین سفارش هر مشتری" metric={data.metrics.averageOrdersPerCustomer} format={decimal} />
    </div>

    <section className="customer-panel">
      <header className="customer-section-heading"><div><h2>مشتریان جدید و بازگشتی</h2><p>بازگشتی یعنی پیش از شروع بازه دست‌کم یک خرید تکمیل‌شده داشته‌اند.</p></div><div className="customer-rate">نرخ بازگشت: <strong>{percent(data.metrics.returningCustomerRate.value)}</strong><small>دوره قبل: {percent(data.metrics.returningCustomerRate.previousValue)} · <RateDelta metric={data.metrics.returningCustomerRate} /></small></div></header>
      <div className="customer-type-grid">{[newCustomer, returning].map((item) => <article key={item.key}>
        <div><strong>{item.label}</strong><b>{number(item.customers)} مشتری · {percent(item.customerSharePercent)}</b></div>
        <div className="customer-bar"><span style={{ width: `${Math.min(100, Number(item.customerSharePercent))}%` }} /></div>
        <p>درآمد: {toman(item.revenueToman)} <small>({percent(item.revenueSharePercent)} از درآمد مشتریان)</small></p>
      </article>)}</div>
    </section>

    <div className="customer-trends"><CustomerTrend title="مشتریان یکتا در طول زمان" description="هر مشتری در هر بازه‌ای که خرید کرده یک بار شمرده می‌شود؛ ممکن است در چند بازه تکرار شود." series={data.trends.uniqueCustomers} granularity={data.granularity} timezone={data.timezone} />
      <CustomerTrend title="مشتریان جدید در طول زمان" description="اولین سفارش تکمیل‌شده هر مشتری در کل سابقه کافه تعیین‌کننده است." series={data.trends.newCustomers} granularity={data.granularity} timezone={data.timezone} />
      <CustomerTrend title="مشتریان بازگشتی در طول زمان" description="بازگشتی یعنی خرید تکمیل‌شده‌ای پیش از شروع همان بازه زمانی داشته باشند." series={data.trends.returningCustomers} granularity={data.granularity} timezone={data.timezone} />
    </div>

    <div className="customer-behavior-grid">
      <section className="customer-panel"><h2>رفتار خرید</h2><dl>
        <div><dt>میانگین فاصله بین خریدها</dt><dd>{data.behavior.averageDaysBetweenOrders === null ? "هنوز قابل محاسبه نیست" : `${decimal(data.behavior.averageDaysBetweenOrders)} روز`}</dd></div>
        <div><dt>درآمد مشتریان در بازه</dt><dd>{toman(data.metrics.knownCustomerRevenueToman.value)}</dd></div>
        <div><dt>مشتریان یک‌بار خرید</dt><dd>{number(data.behavior.oneTimeCustomers)}</dd></div>
        <div><dt>مشتریان تکراری در کل سابقه</dt><dd>{number(data.behavior.repeatCustomers)}</dd></div>
        <div><dt>سهم درآمد ۱۰ مشتری برتر</dt><dd>{percent(data.behavior.topTenRevenueSharePercent)}</dd></div>
      </dl><p className="customer-caption">میانگین فاصله، بر اساس فاصله بین خریدهای پیاپی تکمیل‌شده در کل سابقه کافه محاسبه می‌شود.</p></section>
      <section className="customer-panel"><h2>توزیع تعداد سفارش مشتریان فعال</h2><p className="customer-caption">مشتریانی که در بازه انتخاب‌شده خرید کرده‌اند، بر اساس تعداد سفارش تکمیل‌شده در کل سابقه.</p><ul className="customer-distribution">{data.behavior.orderCountDistribution.map((item) => <li key={item.key}><span>{item.label}</span><strong>{number(item.customers)}</strong></li>)}</ul></section>
    </div>
    <p className="analytics-note">همه سفارش‌های UCafe به مشتری شناخته‌شده و مختص همان کافه وصل هستند؛ سفارش ناشناس پشتیبانی نمی‌شود. پوشش درآمد: {percent(data.coverage.identifiedRevenuePercent)} · پوشش سفارش: {percent(data.coverage.identifiedOrderPercent)}. درآمد برابر ارزش سفارش‌های تحویل‌شده است؛ دریافت وجه در سامانه ثبت نمی‌شود. شماره تماس در این گزارش نمایش داده نمی‌شود.</p>
    <CustomerRankings data={data} timezone={data.timezone} />
  </div>;
}
