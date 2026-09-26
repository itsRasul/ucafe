import { FormEvent } from "react";
import { JalaliDateInput } from "../../jalali-date-input";

export type AnalyticsPeriod = "today" | "yesterday" | "last7Days" | "last30Days" | "currentMonth" | "previousMonth" | "currentYear" | "previousYear" | "custom";
const periods: Array<[AnalyticsPeriod, string]> = [["today", "امروز"], ["yesterday", "دیروز"], ["last7Days", "۷ روز اخیر"], ["last30Days", "۳۰ روز اخیر"], ["currentMonth", "این ماه"], ["previousMonth", "ماه قبل"], ["currentYear", "امسال"], ["previousYear", "سال قبل"], ["custom", "بازه دلخواه"]];

export function AnalyticsPeriodFilter({ period, start, end, onPeriodChange, onStartChange, onEndChange, onSubmit }: {
  period: AnalyticsPeriod; start: string; end: string;
  onPeriodChange: (period: AnalyticsPeriod) => void; onStartChange: (value: string) => void;
  onEndChange: (value: string) => void; onSubmit: (event: FormEvent) => void;
}) {
  return <form className="analytics-filter" onSubmit={onSubmit}>
    <label htmlFor="analytics-period">بازه گزارش</label>
    <select id="analytics-period" value={period} onChange={(event) => onPeriodChange(event.target.value as AnalyticsPeriod)}>
      {periods.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
    {period === "custom" && <>
      <label>از تاریخ<JalaliDateInput value={start} onChange={onStartChange} required /></label>
      <label>تا تاریخ<JalaliDateInput value={end} onChange={onEndChange} required /></label>
      <button type="submit">نمایش گزارش</button>
    </>}
  </form>;
}
