"use client";
import { TimeView, TimeDistribution } from "../admin/analytics/time-view";
import "../admin/analytics/analytics.css";
const weekdays = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];
const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: String(hour === 19 ? 12500000 : hour % 4 === 0 ? hour * 120000 : 0), completedOrders: String(hour === 18 ? 42 : hour % 4 === 0 ? hour : 0) }));
const days = weekdays.map((weekday, i) => ({ weekday, revenue: String((i + 1) * 1300000), completedOrders: String((i + 1) * 7) }));
const dates = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, revenue: String(i % 5 === 0 ? 0 : i * 210000), completedOrders: String(i % 5 === 0 ? 0 : i + 2) }));
const data: TimeDistribution = { current: { start: "2026-09-01", endExclusive: "2026-10-01" }, hours, weekdays: days, heatmap: days.flatMap(({ weekday }, i) => hours.map(({ hour }) => ({ weekday, hour, revenue: String((i + hour) % 5 ? (i + hour) * 60000 : 0), completedOrders: String((i + hour) % 5 ? i + hour : 0) }))), dates, peaks: { revenueHours: [hours[19]!], orderHours: [hours[18]!], revenueWeekdays: [days[6]!], orderWeekdays: [days[6]!], revenueDates: [dates[29]!], orderDates: [dates[29]!], lowestActiveRevenueDates: [dates[1]!] } };
export default function Preview() { return <main dir="rtl" style={{ maxWidth: 1300, margin: "auto", padding: 20, background: "#f8fbfc" }}><h1>تحلیل زمانی</h1><TimeView data={data} /></main>; }
