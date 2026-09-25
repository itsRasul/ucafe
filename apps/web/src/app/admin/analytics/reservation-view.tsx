"use client";

import { useState } from "react";
import { formatJalaliDate } from "../../jalali-date";
import { WeeklyHeatmap } from "./time-view";

type Metric = { value: string | null; previousValue: string | null; change: string | null; changePercent: string | null };
type Point = { bucket: string; label: string; value: string };
type Series = { key: string; label: string; points: Point[] };
type Measure = { reservationCount: string; reservedGuests: string };
type TimeBucket = Measure & { hour: number };
type WeekBucket = Measure & { weekday: string };
type DateBucket = Measure & { date: string };

export type ReservationAnalytics = {
  timezone: string;
  granularity: "hour" | "day" | "week" | "month" | "year";
  metrics: {
    createdReservations: Metric; scheduledReservations: Metric; confirmedReservations: Metric;
    completedReservations: Metric; cancelledReservations: Metric; rejectedReservations: Metric;
    noShowReservations: Metric; reservedGuests: Metric; averagePartySize: Metric; largestPartySize: { value: string | null; previousValue: string | null };
    confirmationRate: Metric; completionRate: Metric; cancellationRate: Metric; rejectionRate: Metric; noShowRate: Metric;
    averageBookingLeadTimeHours: { value: string | null; previousValue: string | null };
    averageCancellationLeadTimeHours: { value: string | null; previousValue: string | null };
  };
  statusBreakdown: Array<{ status: string; reservationCount: string; sharePercent: string }>;
  trends: {
    createdReservations: Series; scheduledReservations: Series; reservedGuests: Series;
    cancellationTrend: Series; rejectionTrend: Series; noShowTrend: Series;
  };
  distribution: {
    weekdays: WeekBucket[]; hours: TimeBucket[]; heatmap: Array<WeekBucket & TimeBucket>;
    dates: DateBucket[]; partySizes: Array<{ partySize: number; reservationCount: string; sharePercent: string }>;
  };
  peaks: {
    reservationHours: TimeBucket[]; guestHours: TimeBucket[]; reservationWeekdays: WeekBucket[];
    guestWeekdays: WeekBucket[]; reservationDates: DateBucket[]; guestDates: DateBucket[];
  };
};

type Granularity = ReservationAnalytics["granularity"];
type MetricName = keyof Measure;
const fa = new Intl.NumberFormat("fa-IR");
const dayNames: Record<string, string> = { saturday: "شنبه", sunday: "یکشنبه", monday: "دوشنبه", tuesday: "سه‌شنبه", wednesday: "چهارشنبه", thursday: "پنجشنبه", friday: "جمعه" };
const statuses: Record<string, string> = { PENDING: "در انتظار تأیید", CONFIRMED: "تأییدشده", COMPLETED: "تکمیل‌شده", CANCELED: "لغوشده", REJECTED: "ردشده", NO_SHOW: "عدم حضور" };
const number = (value: string) => fa.format(BigInt(value));
const decimal = (value: string) => {
  const [whole, fraction] = value.split(".");
  return fraction === undefined ? number(value) : number(whole!) + "٫" + number(fraction);
};
const percent = (value: string | null) => value === null ? "قابل محاسبه نیست" : decimal(value) + "٪";
const hourLabel = (hour: number) => String(hour).padStart(2, "0") + ":00";
const displayMeasure = (value: string, metric: MetricName) => number(value) + (metric === "reservedGuests" ? " مهمان" : " رزرو");
const strongest = (value: string, max: bigint) => max === BigInt(0) ? 0 : Number(BigInt(value) * BigInt(10000) / max) / 100;

function Kpi({ title, metric, format, rate = false, lowerIsBetter = false }: { title: string; metric: Metric; format: (value: string) => string; rate?: boolean; lowerIsBetter?: boolean }) {
  const decrease = metric.change?.startsWith("-") ?? false;
  const direction = metric.change === null ? "unknown" : metric.change === "0" || metric.change === "0.00" ? "flat" : decrease === lowerIsBetter ? "up" : "down";
  const comparison = rate && metric.change !== null
    ? (metric.change.startsWith("-") || metric.change === "0.00" ? "" : "+") + decimal(metric.change) + " واحد درصد"
    : metric.changePercent === null ? "مقایسه در دسترس نیست" : (metric.changePercent.startsWith("-") || metric.changePercent === "0.00" ? "" : "+") + percent(metric.changePercent);
  return <article className="analytics-kpi"><span>{title}</span><strong>{metric.value === null ? "قابل محاسبه نیست" : format(metric.value)}</strong><div><span className={"analytics-change " + direction}>{comparison}</span><small>دوره قبل: {metric.previousValue === null ? "قابل محاسبه نیست" : format(metric.previousValue)}</small></div></article>;
}

function bucketLabel(point: Point, granularity: Granularity, timezone: string, localHour = false) {
  if (granularity === "hour" && localHour) return point.label;
  if (granularity === "hour") return new Intl.DateTimeFormat("fa-IR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(point.bucket));
  return formatJalaliDate(point.bucket.slice(0, 10));
}

function Trend({ title, description, series, granularity, timezone, localHour = false }: { title: string; description: string; series: Series; granularity: Granularity; timezone: string; localHour?: boolean }) {
  const [active, setActive] = useState(0);
  const points = series.points;
  const peak = points.reduce((largest, point) => BigInt(point.value) > largest ? BigInt(point.value) : largest, BigInt(0));
  const width = Math.max(680, points.length * 31 + 58);
  const step = points.length < 2 ? 0 : (width - 70) / (points.length - 1);
  const coords = points.map((point, index) => ({ x: 35 + step * index, y: 160 - Number(BigInt(point.value) * BigInt(116) / (peak || BigInt(1))) }));
  const selected = points[Math.min(active, points.length - 1)];
  const every = Math.max(1, Math.ceil(points.length / 7));
  return <section className="analytics-trend" aria-label={title}><header><div><h2>{title}</h2><p>{description}</p></div>{selected && <div className="analytics-chart-reading"><strong>{number(selected.value)}</strong><span>{bucketLabel(selected, granularity, timezone, localHour)}</span></div>}</header><div className="analytics-chart-scroll" tabIndex={0} aria-label={"نمودار " + title + "؛ برای دیدن همه بازه‌ها پیمایش کنید"}><svg width={width} height="220" viewBox={"0 0 " + width + " 220"} role="img" aria-label={title + " در " + fa.format(points.length) + " بازه"}>{[44, 102, 160].map((y) => <line key={y} className="analytics-grid-line" x1="35" y1={y} x2={width - 35} y2={y} />)}<polyline className="analytics-line" points={coords.map(({ x, y }) => x + "," + y).join(" ")} />{points.map((point, index) => <g key={point.bucket}><circle className={"analytics-dot " + (active === index ? "active" : "")} cx={coords[index]!.x} cy={coords[index]!.y} r={active === index ? 5 : 3.5} tabIndex={0} role="button" aria-label={bucketLabel(point, granularity, timezone, localHour) + ": " + number(point.value)} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(index); } }}><title>{bucketLabel(point, granularity, timezone, localHour) + ": " + number(point.value)}</title></circle>{(index % every === 0 || index === points.length - 1) && <text className="analytics-axis-label" x={coords[index]!.x} y="198" textAnchor="middle">{bucketLabel(point, granularity, timezone, localHour)}</text>}</g>)}</svg></div></section>;
}

function Bars<T>({ title, rows, metric, label, value }: { title: string; rows: T[]; metric: MetricName; label: (row: T) => string; value: (row: T) => string }) {
  const max = rows.reduce((largest, row) => BigInt(value(row)) > largest ? BigInt(value(row)) : largest, BigInt(0));
  return <section className="analytics-time-panel"><h2>{title}</h2><div className="analytics-bars-scroll" tabIndex={0} aria-label={title + "؛ برای دیدن همه ستون‌ها پیمایش کنید"}><div className="analytics-bars" style={{ minWidth: rows.length === 24 ? 840 : 400 }}>{rows.map((row, index) => <div className="analytics-bar-item" key={index} tabIndex={0} role="img" aria-label={label(row) + ": " + displayMeasure(value(row), metric)} title={label(row) + ": " + displayMeasure(value(row), metric)}><span className="analytics-bar-value">{max > BigInt(0) && value(row) !== "0" ? number(value(row)) : ""}</span><div className="analytics-bar-track"><span style={{ height: strongest(value(row), max) + "%" }} /></div><span className="analytics-bar-label">{label(row)}</span></div>)}</div></div></section>;
}

function OutcomeBreakdown({ data }: { data: ReservationAnalytics }) {
  const max = data.statusBreakdown.reduce((largest, row) => BigInt(row.reservationCount) > largest ? BigInt(row.reservationCount) : largest, BigInt(0));
  return <div className="order-status-list">{data.statusBreakdown.map((row) => <div className="order-status-row" key={row.status}><span>{statuses[row.status] ?? row.status}</span><div className="order-status-track"><i style={{ width: strongest(row.reservationCount, max) + "%" }} /></div><strong>{number(row.reservationCount)}</strong><small>{percent(row.sharePercent)}</small></div>)}</div>;
}

function Peaks({ data }: { data: ReservationAnalytics }) {
  const cards: Array<[string, string, string]> = [
    ["بیشترین رزرو در ساعت", data.peaks.reservationHours.map((row) => hourLabel(row.hour)).join("، "), data.peaks.reservationHours[0]?.reservationCount ?? "0"],
    ["بیشترین مهمان در ساعت", data.peaks.guestHours.map((row) => hourLabel(row.hour)).join("، "), data.peaks.guestHours[0]?.reservedGuests ?? "0"],
    ["پرسفارش‌ترین روز هفته", data.peaks.reservationWeekdays.map((row) => dayNames[row.weekday]).join("، "), data.peaks.reservationWeekdays[0]?.reservationCount ?? "0"],
    ["بیشترین مهمان در روز هفته", data.peaks.guestWeekdays.map((row) => dayNames[row.weekday]).join("، "), data.peaks.guestWeekdays[0]?.reservedGuests ?? "0"],
    ["بیشترین رزرو در تاریخ", data.peaks.reservationDates.map((row) => formatJalaliDate(row.date)).join("، "), data.peaks.reservationDates[0]?.reservationCount ?? "0"],
    ["بیشترین مهمان در تاریخ", data.peaks.guestDates.map((row) => formatJalaliDate(row.date)).join("، "), data.peaks.guestDates[0]?.reservedGuests ?? "0"],
  ];
  return <div className="analytics-peak-grid">{cards.map(([title, label, value]) => <article className="analytics-peak" key={title}><span>{title}</span><strong>{label || "—"}</strong>{label && <small>{number(value)}</small>}</article>)}</div>;
}

export function ReservationView({ data }: { data: ReservationAnalytics }) {
  const [metric, setMetric] = useState<MetricName>("reservationCount");
  const hasScheduled = data.metrics.scheduledReservations.value !== "0";
  const metricTitle = metric === "reservationCount" ? "رزروها" : "تعداد مهمان";
  const metricSwitch = <div className="analytics-metric-switch" role="group" aria-label="معیار تقاضای رزرو"><button type="button" aria-pressed={metric === "reservationCount"} onClick={() => setMetric("reservationCount")}>رزروها</button><button type="button" aria-pressed={metric === "reservedGuests"} onClick={() => setMetric("reservedGuests")}>تعداد مهمان</button></div>;
  const trendProps = { granularity: data.granularity, timezone: data.timezone };
  return <div className="analytics-results reservation-analytics">
    <p className="analytics-time-intro">بازه اصلی بر اساس زمان رزرو برنامه‌ریزی‌شده است. رزروهای ثبت‌شده بر اساس زمان ایجاد و تغییر روند وضعیت‌های نهایی بر اساس زمان ثبت همان تغییر نمایش داده می‌شوند.</p>
    <div className="analytics-kpis order-kpis">
      <Kpi title="رزروهای ثبت‌شده" metric={data.metrics.createdReservations} format={number} />
      <Kpi title="رزروهای برنامه‌ریزی‌شده" metric={data.metrics.scheduledReservations} format={number} />
      <Kpi title="رزروهای تأییدشده" metric={data.metrics.confirmedReservations} format={number} />
      <Kpi title="مهمانان رزروشده" metric={data.metrics.reservedGuests} format={number} />
      <Kpi title="نرخ تأیید" metric={data.metrics.confirmationRate} format={percent} rate />
      <Kpi title="نرخ تکمیل" metric={data.metrics.completionRate} format={percent} rate />
      <Kpi title="نرخ لغو" metric={data.metrics.cancellationRate} format={percent} rate lowerIsBetter />
      <Kpi title="نرخ عدم حضور" metric={data.metrics.noShowRate} format={percent} rate lowerIsBetter />
      <Kpi title="میانگین نفرات هر رزرو" metric={data.metrics.averagePartySize} format={decimal} />
    </div>
    {!hasScheduled && <div className="analytics-empty"><strong>در این بازه رزروی برنامه‌ریزی نشده است.</strong><p>پس از ثبت رزرو، زمان‌های پرتردد و نتایج مراجعه اینجا نمایش داده می‌شوند.</p></div>}
    <Peaks data={data} />
    <div className="analytics-secondary">
      <Trend title="رزروهای ثبت‌شده در طول زمان" description="بر اساس زمان ایجاد رزرو" series={data.trends.createdReservations} localHour={false} {...trendProps} />
      <Trend title="رزروهای برنامه‌ریزی‌شده در طول زمان" description="بر اساس تاریخ و ساعت مراجعه" series={data.trends.scheduledReservations} localHour {...trendProps} />
    </div>
    <Trend title="مهمانان رزروشده در طول زمان" description="مجموع نفرات رزروهای فعال و مراجعه‌های ثبت‌شده" series={data.trends.reservedGuests} localHour {...trendProps} />
    <div className="analytics-time-two">
      <Bars title={"رزروها بر اساس روز هفته · " + metricTitle} rows={data.distribution.weekdays} metric={metric} label={(row) => dayNames[row.weekday]!} value={(row) => row[metric]} />
      <Bars title={"رزروها بر اساس ساعت · " + metricTitle} rows={data.distribution.hours} metric={metric} label={(row) => hourLabel(row.hour)} value={(row) => row[metric]} />
    </div>
    <section className="analytics-time-panel"><div className="analytics-time-header"><div><h2>نقشه روز و ساعت رزرو</h2><p>هر خانه مجموع رزروهای برنامه‌ریزی‌شده در همان روز و ساعت است.</p></div>{metricSwitch}</div><WeeklyHeatmap days={data.distribution.weekdays} hours={data.distribution.hours} cells={data.distribution.heatmap} value={(cell) => cell[metric]} dayLabel={(weekday) => dayNames[weekday]!} formatCell={(cell) => dayNames[cell.weekday]! + "، " + hourLabel(cell.hour) + ": " + displayMeasure(cell[metric], metric)} emptyReading="برای دیدن تعداد رزرو یا مهمان، یک خانه را انتخاب کنید." /></section>
    <div className="analytics-time-two">
      <section className="analytics-time-panel"><h2>وضعیت رزروهای برنامه‌ریزی‌شده در بازه</h2><p>وضعیت فعلی هر رزرو اینجا نمایش داده می‌شود.</p><OutcomeBreakdown data={data} /></section>
      <section className="analytics-time-panel"><div className="analytics-time-header"><div><h2>اندازه گروه</h2><p>توزیع دقیق تعداد نفرات رزروهای فعال و انجام‌شده</p></div></div>{data.distribution.partySizes.length ? <div className="order-size-list">{data.distribution.partySizes.map((row) => <div key={row.partySize}><span>{fa.format(row.partySize)} نفر · {percent(row.sharePercent)}</span><strong>{number(row.reservationCount)}</strong></div>)}</div> : <p>داده‌ای برای اندازه گروه در این بازه نیست.</p>}<p>بزرگ‌ترین گروه ثبت‌شده: {data.metrics.largestPartySize.value === null ? "—" : number(data.metrics.largestPartySize.value) + " نفر"}</p></section>
    </div>
    <section className="analytics-time-panel"><div className="analytics-time-header"><div><h2>روند نتیجه رزروها</h2><p>بر اساس تاریخ ثبت تغییر وضعیت نهایی، نه زمان رزرو.</p></div></div><div className="analytics-secondary"><Trend title="لغو رزرو" description="وضعیت CANCELED" series={data.trends.cancellationTrend} {...trendProps} /><Trend title="عدم حضور" description="وضعیت NO_SHOW ثبت‌شده توسط کافه" series={data.trends.noShowTrend} {...trendProps} /></div><Trend title="رد درخواست" description="وضعیت REJECTED" series={data.trends.rejectionTrend} {...trendProps} /></section>
    <section className="analytics-time-panel"><h2>رفتار زمانی رزرو</h2><div className="order-size-list"><div><span>میانگین فاصله ثبت تا زمان رزرو</span><strong>{data.metrics.averageBookingLeadTimeHours.value === null ? "قابل محاسبه نیست" : decimal(data.metrics.averageBookingLeadTimeHours.value) + " ساعت"}</strong></div><div><span>میانگین زمان باقی‌مانده هنگام لغو</span><strong>{data.metrics.averageCancellationLeadTimeHours.value === null ? "قابل محاسبه نیست" : decimal(data.metrics.averageCancellationLeadTimeHours.value) + " ساعت"}</strong></div></div><p>تأخیرهای منفی از میانگین حذف شده‌اند. زمان لغو فقط برای رزروهایی محاسبه می‌شود که در زمان رزرو یا پیش از آن لغو شده‌اند.</p></section>
  </div>;
}
