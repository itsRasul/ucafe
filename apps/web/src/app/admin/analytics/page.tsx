"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { JalaliDateInput } from "../../jalali-date-input";
import { formatJalaliDate } from "../../jalali-date";
import { useAdminSession } from "../admin-session";
import { TimeDistribution, TimeView } from "./time-view";
import "./analytics.css";

type Period = "today" | "yesterday" | "last7Days" | "last30Days" | "currentMonth" | "previousMonth" | "currentYear" | "previousYear" | "custom";
type Metric = { value: string; previousValue: string; change: string; changePercent: string | null };
type Point = { bucket: string; label: string; value: string };
type Series = { key: string; label: string; points: Point[] };
type Overview = {
  period: Period; timezone: string; granularity: "hour" | "day" | "week" | "month" | "year";
  current: { start: string; endExclusive: string };
  metrics: { revenueToman: Metric; completedOrders: Metric; averageOrderValueToman: Metric; uniqueCustomers: Metric };
  series: { revenueToman: Series; completedOrders: Series; averageOrderValueToman: Series };
};

const periods: Array<[Period, string]> = [["today", "امروز"], ["yesterday", "دیروز"], ["last7Days", "۷ روز اخیر"], ["last30Days", "۳۰ روز اخیر"], ["currentMonth", "این ماه"], ["previousMonth", "ماه قبل"], ["currentYear", "امسال"], ["previousYear", "سال قبل"], ["custom", "بازه دلخواه"]];
const fa = new Intl.NumberFormat("fa-IR");
const digits = "۰۱۲۳۴۵۶۷۸۹";
const number = (value: string) => fa.format(BigInt(value));
const toman = (value: string) => `${number(value)} تومان`;
const percent = (value: string | null) => value === null ? "مقایسه در دسترس نیست" : `${value.startsWith("-") ? "" : value === "0.00" ? "" : "+"}${value.replace(/\d/g, (digit) => digits[Number(digit)]!)}٪`;

function Comparison({ metric }: { metric: Metric }) {
  const direction = metric.changePercent === null ? "unknown" : BigInt(metric.change) > BigInt(0) ? "up" : BigInt(metric.change) < BigInt(0) ? "down" : "flat";
  return <span className={`analytics-change ${direction}`}>{percent(metric.changePercent)}</span>;
}

function labelFor(point: Point, granularity: Overview["granularity"], timezone: string) {
  if (granularity === "hour") return new Intl.DateTimeFormat("fa-IR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(point.bucket));
  return formatJalaliDate(point.bucket.slice(0, 10));
}

function Trend({ title, description, series, granularity, timezone, money = false }: { title: string; description: string; series: Series; granularity: Overview["granularity"]; timezone: string; money?: boolean }) {
  const [active, setActive] = useState(0);
  const points = series.points;
  const peak = points.reduce((largest, point) => BigInt(point.value) > largest ? BigInt(point.value) : largest, BigInt(0));
  const width = Math.max(680, points.length * 31 + 58);
  const step = points.length < 2 ? 0 : (width - 70) / (points.length - 1);
  const xy = points.map((point, index) => ({ x: 35 + step * index, y: 160 - Number(BigInt(point.value) * BigInt(116) / (peak || BigInt(1))) }));
  const selected = points[Math.min(active, points.length - 1)];
  const display = (value: string) => money ? toman(value) : number(value);
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  return <section className="analytics-trend" aria-label={title}>
    <header><div><h2>{title}</h2><p>{description}</p></div>{selected && <div className="analytics-chart-reading"><strong>{display(selected.value)}</strong><span>{labelFor(selected, granularity, timezone)}</span></div>}</header>
    <div className="analytics-chart-scroll" tabIndex={0} aria-label={`نمودار ${title}؛ برای دیدن همه بازه‌ها پیمایش کنید`}>
      <svg width={width} height="220" viewBox={`0 0 ${width} 220`} role="img" aria-label={`${title} در ${points.length} بازه`}>
        {[44, 102, 160].map((y) => <line key={y} className="analytics-grid-line" x1="35" y1={y} x2={width - 35} y2={y} />)}
        <polyline className="analytics-line" points={xy.map(({ x, y }) => `${x},${y}`).join(" ")} />
        {points.map((point, index) => <g key={point.bucket}>
          <circle className={`analytics-dot ${active === index ? "active" : ""}`} cx={xy[index]!.x} cy={xy[index]!.y} r={active === index ? 5.5 : 4} tabIndex={0} role="button" aria-label={`${labelFor(point, granularity, timezone)}: ${display(point.value)}`} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(index); } }}><title>{labelFor(point, granularity, timezone)}: {display(point.value)}</title></circle>
          {(index % labelEvery === 0 || index === points.length - 1) && <text className="analytics-axis-label" x={xy[index]!.x} y="198" textAnchor="middle">{labelFor(point, granularity, timezone)}</text>}
        </g>)}
      </svg>
    </div>
  </section>;
}

export default function AnalyticsPage() {
  const { access, api } = useAdminSession();
  const [period, setPeriod] = useState<Period>("last7Days");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [query, setQuery] = useState("period=last7Days");
  const [data, setData] = useState<Overview | null>(null);
  const [timeData, setTimeData] = useState<TimeDistribution | null>(null);
  const [view, setView] = useState<"overview" | "time">("overview");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const permitted = access.permissions.includes("analytics.read");

  useEffect(() => {
    if (!permitted) return;
    const controller = new AbortController();
    setBusy(true); setError(""); setUnavailable(false);
    const path = view === "overview" ? "overview" : "time-distribution";
    api<Overview | TimeDistribution>(`/tenant/analytics/${path}?${query}`, { signal: controller.signal }).then((result) => {
      if (view === "overview") setData(result as Overview);
      else setTimeData(result as TimeDistribution);
    }).catch((reason: Error & { code?: string }) => {
      if (controller.signal.aborted) return;
      if (reason.code === "FEATURE_UNAVAILABLE") setUnavailable(true);
      else setError(reason.message);
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [api, permitted, query, retry, view]);

  function selectPeriod(next: Period) { setPeriod(next); if (next !== "custom") setQuery(`period=${next}`); }
  function applyCustom(event: FormEvent) {
    event.preventDefault();
    if (!start || !end || end < start) { setError("تاریخ شروع و پایان معتبر انتخاب کنید."); return; }
    setError("");
    setQuery(new URLSearchParams({ period: "custom", start, end }).toString());
  }

  if (!permitted) return <section className="admin-section-state"><h1>آمار و تحلیل</h1><p>نقش شما اجازه مشاهده آمار این کافه را ندارد.</p></section>;
  return <section className="analytics-page">
    <header className="analytics-heading"><div><h1>آمار و تحلیل</h1><p>فروش تحویل‌شده و روند سفارش‌های کافه، بر اساس زمان محلی آن.</p></div><span>گزارش سفارش‌ها</span></header>
    <form className="analytics-filter" onSubmit={applyCustom}><label htmlFor="analytics-period">بازه گزارش</label><select id="analytics-period" value={period} onChange={(event) => selectPeriod(event.target.value as Period)}>{periods.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{period === "custom" && <><label>از تاریخ<JalaliDateInput value={start} onChange={setStart} required /></label><label>تا تاریخ<JalaliDateInput value={end} onChange={setEnd} required /></label><button type="submit">نمایش گزارش</button></>}</form>
    <nav className="analytics-tabs" aria-label="بخش‌های آمار"><button type="button" aria-current={view === "overview" ? "page" : undefined} onClick={() => setView("overview")}>نمای کلی</button><button type="button" aria-current={view === "time" ? "page" : undefined} onClick={() => setView("time")}>تحلیل زمانی</button></nav>
    {unavailable ? <div className="analytics-state"><h2>آمار و تحلیل در اشتراک فعلی فعال نیست</h2><p>برای بررسی پلن‌های دارای این امکان، صفحه اشتراک را ببینید.</p><Link href="/admin/subscription">مشاهده پلن‌ها</Link></div> : error ? <div className="analytics-state" role="alert"><h2>گزارش دریافت نشد</h2><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>تلاش دوباره</button></div> : busy ? <div className="analytics-loading" role="status"><span className="admin-spinner" />در حال آماده‌سازی گزارش…</div> : view === "time" && timeData ? <TimeView data={timeData} /> : view === "overview" && data && <div className="analytics-results" aria-busy={busy}>
      <div className="analytics-kpis"><article className="analytics-kpi main"><span>فروش تحویل‌شده</span><strong>{toman(data.metrics.revenueToman.value)}</strong><div><Comparison metric={data.metrics.revenueToman} /><small>دوره قبل: {toman(data.metrics.revenueToman.previousValue)}</small></div></article><article className="analytics-kpi"><span>سفارش‌های تکمیل‌شده</span><strong>{number(data.metrics.completedOrders.value)}</strong><div><Comparison metric={data.metrics.completedOrders} /><small>دوره قبل: {number(data.metrics.completedOrders.previousValue)}</small></div></article><article className="analytics-kpi"><span>میانگین هر سفارش</span><strong>{toman(data.metrics.averageOrderValueToman.value)}</strong><div><Comparison metric={data.metrics.averageOrderValueToman} /><small>دوره قبل: {toman(data.metrics.averageOrderValueToman.previousValue)}</small></div></article><article className="analytics-kpi"><span>مشتریان یکتا</span><strong>{number(data.metrics.uniqueCustomers.value)}</strong><div><Comparison metric={data.metrics.uniqueCustomers} /><small>دوره قبل: {number(data.metrics.uniqueCustomers.previousValue)}</small></div></article></div>
      {data.metrics.completedOrders.value === "0" && <div className="analytics-empty"><strong>هنوز فروش تحویل‌شده‌ای برای این بازه ثبت نشده است.</strong><p>پس از تکمیل سفارش‌ها، روند فروش و تعداد سفارش‌ها اینجا دیده می‌شود.</p></div>}
      <Trend title="روند فروش" description="ارزش سفارش‌های تحویل‌شده در هر بازه" series={data.series.revenueToman} granularity={data.granularity} timezone={data.timezone} money />
      <div className="analytics-secondary"><Trend title="روند سفارش‌ها" description="تعداد سفارش‌های تکمیل‌شده" series={data.series.completedOrders} granularity={data.granularity} timezone={data.timezone} /><Trend title="میانگین هر سفارش" description="فروش هر بازه تقسیم بر سفارش‌های همان بازه" series={data.series.averageOrderValueToman} granularity={data.granularity} timezone={data.timezone} money /></div>
      <section className="analytics-comparison"><h2>در مقایسه با دوره قبل</h2><div>{([ ["فروش", data.metrics.revenueToman, true], ["سفارش‌ها", data.metrics.completedOrders, false], ["میانگین هر سفارش", data.metrics.averageOrderValueToman, true], ["مشتریان یکتا", data.metrics.uniqueCustomers, false] ] as const).map(([label, metric, isMoney]) => <div key={label}><span>{label}</span><strong>{isMoney ? toman(metric.value) : number(metric.value)}</strong><small>{isMoney ? toman(metric.previousValue) : number(metric.previousValue)} در دوره قبل</small><Comparison metric={metric} /></div>)}</div></section>
      <p className="analytics-note">«فروش» ارزش سفارش‌های تحویل‌شده است؛ تأیید دریافت وجه نقدی در سفارش‌های فعلی ثبت نمی‌شود.</p>
    </div>}
  </section>;
}
