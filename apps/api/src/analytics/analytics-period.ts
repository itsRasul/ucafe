import { BadRequestException } from "@nestjs/common";
import { isValidIsoDate, localDateTimeParts } from "../reservations/reservation-time.util";

export const ANALYTICS_PERIODS = ["today", "yesterday", "last7Days", "last30Days", "currentMonth", "previousMonth", "currentYear", "previousYear", "custom"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];
export type AnalyticsGranularity = "hour" | "day" | "week" | "month" | "year";
export const ANALYTICS_GRANULARITIES: AnalyticsGranularity[] = ["hour", "day", "week", "month", "year"];
export interface LocalRange { start: string; endExclusive: string }
export interface AnalyticsRanges { current: LocalRange; previous: LocalRange; timezone: string }

export function analyticsSeriesParts(granularity: AnalyticsGranularity, eventTime = "o.status_changed_at", timezoneParam = "$5") {
  const slots: Record<AnalyticsGranularity, string> = {
    hour: `SELECT generate_series(b.current_start, b.current_end - interval '1 microsecond', interval '1 hour') AS bucket FROM bounds b`,
    day: `SELECT generate_series(b.local_start::date, b.local_end::date - 1, interval '1 day')::date AS bucket FROM bounds b`,
    week: `SELECT generate_series(b.local_start::date, b.local_end::date - 1, interval '7 days')::date AS bucket FROM bounds b`,
    month: `SELECT generate_series(date_trunc('month', b.local_start::timestamp), date_trunc('month', (b.local_end::date - 1)::timestamp), interval '1 month')::date AS bucket FROM bounds b`,
    year: `SELECT generate_series(date_trunc('year', b.local_start::timestamp), date_trunc('year', (b.local_end::date - 1)::timestamp), interval '1 year')::date AS bucket FROM bounds b`,
  };
  const bucket: Record<AnalyticsGranularity, string> = {
    hour: `date_bin('1 hour', ${eventTime}, b.current_start)`,
    day: `(${eventTime} AT TIME ZONE ${timezoneParam})::date`,
    week: `b.local_start::date + ((((${eventTime} AT TIME ZONE ${timezoneParam})::date - b.local_start::date) / 7) * 7)`,
    month: `date_trunc('month', ${eventTime} AT TIME ZONE ${timezoneParam})::date`,
    year: `date_trunc('year', ${eventTime} AT TIME ZONE ${timezoneParam})::date`,
  };
  return { slots: slots[granularity], bucket: bucket[granularity], textBucket: granularity === "hour" ? `to_char(s.bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` : `s.bucket::text` };
}

export function analyticsGranularity(range: LocalRange): AnalyticsGranularity {
  const days = (Date.parse(`${range.endExclusive}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86400000;
  return days === 1 ? "hour" : days <= 45 ? "day" : days <= 120 ? "week" : days <= 730 ? "month" : "year";
}

function shift(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function monthStart(date: string, delta = 0): string {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1 + delta, 1)).toISOString().slice(0, 10);
}

function yearStart(date: string, delta = 0): string {
  return `${Number(date.slice(0, 4)) + delta}-01-01`;
}

export function analyticsRanges(period: AnalyticsPeriod, timezone: string, start?: string, end?: string, now = new Date()): AnalyticsRanges {
  const today = localDateTimeParts(timezone, now).date;
  let current: LocalRange;
  let previous: LocalRange;
  switch (period) {
    case "today": current = { start: today, endExclusive: shift(today, 1) }; previous = { start: shift(today, -1), endExclusive: today }; break;
    case "yesterday": current = { start: shift(today, -1), endExclusive: today }; previous = { start: shift(today, -2), endExclusive: shift(today, -1) }; break;
    case "last7Days": case "last30Days": {
      const days = period === "last7Days" ? 7 : 30;
      current = { start: shift(today, 1 - days), endExclusive: shift(today, 1) };
      previous = { start: shift(current.start, -days), endExclusive: current.start };
      break;
    }
    case "currentMonth": case "previousMonth": {
      const delta = period === "currentMonth" ? 0 : -1;
      current = { start: monthStart(today, delta), endExclusive: monthStart(today, delta + 1) };
      previous = { start: monthStart(today, delta - 1), endExclusive: current.start };
      break;
    }
    case "currentYear": case "previousYear": {
      const delta = period === "currentYear" ? 0 : -1;
      current = { start: yearStart(today, delta), endExclusive: yearStart(today, delta + 1) };
      previous = { start: yearStart(today, delta - 1), endExclusive: current.start };
      break;
    }
    case "custom": {
      if (!start || !end || !isValidIsoDate(start) || !isValidIsoDate(end) || end < start) throw new BadRequestException("Invalid custom analytics range");
      const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
      if (days > 366) throw new BadRequestException("Custom analytics range exceeds 366 days");
      current = { start, endExclusive: shift(end, 1) };
      previous = { start: shift(start, -days), endExclusive: start };
      break;
    }
  }
  return { current, previous, timezone };
}
