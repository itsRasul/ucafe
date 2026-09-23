"use client";

import { useState } from "react";
import { formatJalaliDate } from "../../jalali-date";

type Bucket = { revenue: string; completedOrders: string };
type Hour = Bucket & { hour: number };
type Weekday = Bucket & { weekday: string };
type DateBucket = Bucket & { date: string };
export type TimeDistribution = {
  current: { start: string; endExclusive: string };
  hours: Hour[]; weekdays: Weekday[]; heatmap: (Hour & Weekday)[]; dates: DateBucket[];
  peaks: { revenueHours: Hour[]; orderHours: Hour[]; revenueWeekdays: Weekday[]; orderWeekdays: Weekday[]; revenueDates: DateBucket[]; orderDates: DateBucket[]; lowestActiveRevenueDates: DateBucket[] };
};
type Metric = keyof Bucket;
const dayNames: Record<string, string> = { saturday: "شنبه", sunday: "یکشنبه", monday: "دوشنبه", tuesday: "سه‌شنبه", wednesday: "چهارشنبه", thursday: "پنجشنبه", friday: "جمعه" };
const fa = new Intl.NumberFormat("fa-IR");
const display = (value: string, metric: Metric) => `${fa.format(BigInt(value))}${metric === "revenue" ? " تومان" : " سفارش"}`;
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const title = (bucket: Bucket, metric: Metric) => display(bucket[metric], metric);
const maxValue = (buckets: Bucket[], metric: Metric) => buckets.reduce((max, bucket) => BigInt(bucket[metric]) > max ? BigInt(bucket[metric]) : max, BigInt(0));
const strength = (value: string, max: bigint) => max === BigInt(0) ? 0 : Number(BigInt(value) * BigInt(4) / max);

function Bars({ heading, buckets, metric, label }: { heading: string; buckets: Bucket[]; metric: Metric; label: (bucket: Bucket) => string }) {
  const max = maxValue(buckets, metric);
  return <section className="analytics-time-panel"><h2>{heading}</h2><div className="analytics-bars-scroll" tabIndex={0} aria-label={`${heading}؛ برای دیدن همه ستون‌ها پیمایش کنید`}><div className="analytics-bars" style={{ minWidth: buckets.length === 24 ? 840 : 400 }}>
    {buckets.map((bucket, index) => <div className="analytics-bar-item" key={index} tabIndex={0} role="img" aria-label={`${label(bucket)}: ${title(bucket, metric)}`} title={`${label(bucket)}: ${title(bucket, metric)}`}><span className="analytics-bar-value">{max > BigInt(0) && bucket[metric] !== "0" ? fa.format(BigInt(bucket[metric])) : ""}</span><div className="analytics-bar-track"><span style={{ height: `${max ? Number(BigInt(bucket[metric]) * BigInt(100) / max) : 0}%` }} /></div><span className="analytics-bar-label">{label(bucket)}</span></div>)}
  </div></div><p className="analytics-time-description">مقدار هر ستون با نگه داشتن نشانگر یا تمرکز روی نمودار دیده می‌شود.</p></section>;
}

export function TimeView({ data }: { data: TimeDistribution }) {
  const [metric, setMetric] = useState<Metric>("revenue");
  const [selected, setSelected] = useState("");
  const hasData = data.dates.some((date) => date.completedOrders !== "0");
  const summaries = [
    ["ساعت پرفروش", data.peaks.revenueHours, (bucket: Hour) => `${hourLabel(bucket.hour)} تا ${hourLabel((bucket.hour + 1) % 24)}`, "revenue"],
    ["ساعت پرسفارش", data.peaks.orderHours, (bucket: Hour) => hourLabel(bucket.hour), "completedOrders"],
    ["روز هفته پرفروش", data.peaks.revenueWeekdays, (bucket: Weekday) => dayNames[bucket.weekday], "revenue"],
    ["بهترین تاریخ فروش", data.peaks.revenueDates, (bucket: DateBucket) => formatJalaliDate(bucket.date), "revenue"],
  ] as const;
  const heatMax = maxValue(data.heatmap, metric);
  const dateMax = maxValue(data.dates, metric);
  const months = [...new Set(data.dates.map((date) => date.date.slice(0, 7)))];
  return <div className="analytics-time-view">
    <p className="analytics-time-intro">همه ساعت‌ها و روزها در بازه انتخابی، به وقت محلی کافه جمع شده‌اند. این الگو فقط همین بازه را توصیف می‌کند.</p>
    {!hasData ? <div className="analytics-empty"><strong>در این بازه سفارش تحویل‌شده‌ای ثبت نشده است.</strong><p>ساعت‌ها، روزهای هفته و تقویم پس از تکمیل سفارش‌ها نمایش داده می‌شوند.</p></div> : <>
      <div className="analytics-peak-grid">{summaries.map(([heading, items, label, key]) => <article key={heading} className="analytics-peak"><span>{heading}</span><strong>{items.length ? items.map((item) => label(item as never)).join("، ") : "—"}</strong><small>{items.length ? title(items[0]!, key) : ""}</small></article>)}</div>
      <div className="analytics-time-two"><Bars heading="فروش بر اساس ساعت روز" buckets={data.hours} metric="revenue" label={(bucket) => hourLabel((bucket as Hour).hour)} /><Bars heading="سفارش‌ها بر اساس ساعت روز" buckets={data.hours} metric="completedOrders" label={(bucket) => hourLabel((bucket as Hour).hour)} /></div>
      <div className="analytics-time-two"><Bars heading="فروش بر اساس روز هفته" buckets={data.weekdays} metric="revenue" label={(bucket) => dayNames[(bucket as Weekday).weekday]!} /><Bars heading="سفارش‌ها بر اساس روز هفته" buckets={data.weekdays} metric="completedOrders" label={(bucket) => dayNames[(bucket as Weekday).weekday]!} /></div>
      <section className="analytics-time-panel"><div className="analytics-time-header"><div><h2>نقشه فعالیت روز و ساعت</h2><p>هر خانه مجموع همه روزها و ساعت‌های هم‌نام در این بازه است.</p></div><MetricSwitch value={metric} onChange={setMetric} /></div><div className="analytics-heat-scroll" tabIndex={0} aria-label="نقشه فعالیت؛ برای دیدن ساعت‌های دیگر پیمایش کنید"><div className="analytics-heat-grid"><span />{data.hours.map(({ hour }) => <span key={hour}>{hourLabel(hour)}</span>)}{data.weekdays.map(({ weekday }) => <div className="analytics-heat-row" key={weekday}><strong>{dayNames[weekday]}</strong>{data.heatmap.filter((cell) => cell.weekday === weekday).map((cell) => { const text = `${dayNames[weekday]}، ${hourLabel(cell.hour)}: ${title(cell, metric)}`; return <button type="button" key={cell.hour} className={`analytics-heat-cell level-${strength(cell[metric], heatMax)}`} title={text} aria-label={text} onFocus={() => setSelected(text)} onClick={() => setSelected(text)} />; })}</div>)}</div></div><p className="analytics-time-reading" role="status">{selected || "برای دیدن مقدار دقیق، یک خانه را انتخاب کنید."}</p></section>
      <section className="analytics-time-panel"><div className="analytics-time-header"><div><h2>تقویم فروش روزانه</h2><p>روزهای بدون فروش کم‌رنگ هستند؛ تاریخ‌ها در تقویم شمسی نمایش داده می‌شوند.</p></div><MetricSwitch value={metric} onChange={setMetric} /></div><div className="analytics-calendar-months">{months.map((month) => { const days = data.dates.filter((date) => date.date.startsWith(month)); const offset = (new Date(`${days[0]!.date}T00:00:00Z`).getUTCDay() + 1) % 7; return <div className="analytics-calendar-month" key={month}><h3>{formatJalaliDate(days[0]!.date)} تا {formatJalaliDate(days.at(-1)!.date)}</h3><div className="analytics-calendar-grid">{data.weekdays.map(({ weekday }) => <span key={weekday}>{dayNames[weekday]}</span>)}{Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}{days.map((day) => { const text = `${formatJalaliDate(day.date)}؛ ${display(day.revenue, "revenue")}؛ ${display(day.completedOrders, "completedOrders")}`; return <button type="button" key={day.date} className={`analytics-calendar-day level-${strength(day[metric], dateMax)}`} title={text} aria-label={text} onFocus={() => setSelected(text)} onClick={() => setSelected(text)}>{fa.format(Number(day.date.slice(-2)))}</button>; })}</div></div>; })}</div><p className="analytics-time-reading" role="status">{selected || "برای دیدن فروش و سفارش‌ها، یک روز را انتخاب کنید."}</p></section>
      <div className="analytics-date-summary"><p>بیشترین سفارش در یک تاریخ: <strong>{data.peaks.orderDates.map((day) => `${formatJalaliDate(day.date)} (${display(day.completedOrders, "completedOrders")})`).join("، ")}</strong></p><p>کم‌فروش‌ترین تاریخ دارای سفارش: <strong>{data.peaks.lowestActiveRevenueDates.map((day) => `${formatJalaliDate(day.date)} (${display(day.revenue, "revenue")})`).join("، ")}</strong></p></div>
    </>}
  </div>;
}

function MetricSwitch({ value, onChange }: { value: Metric; onChange: (metric: Metric) => void }) {
  return <div className="analytics-metric-switch" role="group" aria-label="معیار نقشه"><button type="button" aria-pressed={value === "revenue"} onClick={() => onChange("revenue")}>فروش</button><button type="button" aria-pressed={value === "completedOrders"} onClick={() => onChange("completedOrders")}>سفارش‌ها</button></div>;
}
