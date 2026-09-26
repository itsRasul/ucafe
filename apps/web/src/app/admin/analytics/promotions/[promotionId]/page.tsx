"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useAdminSession } from "../../../admin-session";
import { AnalyticsPeriod, AnalyticsPeriodFilter } from "../../period-filter";
import { PromotionDetailData, PromotionDetailView } from "../../promotion-view";

const validPeriods: AnalyticsPeriod[] = ["today", "yesterday", "last7Days", "last30Days", "currentMonth", "previousMonth", "currentYear", "previousYear", "custom"];

export default function PromotionAnalyticsDetailPage({ params }: { params: Promise<{ promotionId: string }> }) {
  const [promotionId, setPromotionId] = useState("");
  const { access, api } = useAdminSession();
  const [period, setPeriod] = useState<AnalyticsPeriod>("last7Days");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [query, setQuery] = useState("period=last7Days");
  const [data, setData] = useState<PromotionDetailData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const permitted = access.permissions.includes("analytics.read");

  useEffect(() => { params.then(({ promotionId: id }) => setPromotionId(id)); }, [params]);
  useEffect(() => {
    const values = new URLSearchParams(window.location.search);
    const selected = values.get("period") as AnalyticsPeriod | null;
    if (selected && validPeriods.includes(selected)) {
      setPeriod(selected);
      const from = values.get("start") ?? "", to = values.get("end") ?? "";
      setStart(from); setEnd(to);
      if (selected !== "custom" || from && to) setQuery(new URLSearchParams({ period: selected, ...(selected === "custom" ? { start: from, end: to } : {}) }).toString());
    }
  }, []);
  useEffect(() => {
    if (!permitted || !promotionId) return;
    const controller = new AbortController(); setBusy(true); setError(""); setUnavailable(false);
    api<PromotionDetailData>(`/tenant/analytics/promotions/${promotionId}?${query}`, { signal: controller.signal })
      .then(setData)
      .catch((reason: Error & { code?: string }) => { if (controller.signal.aborted) return; if (reason.code === "FEATURE_UNAVAILABLE") setUnavailable(true); else setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [api, permitted, promotionId, query]);

  function selectPeriod(next: AnalyticsPeriod) { setPeriod(next); if (next !== "custom") setQuery(new URLSearchParams({ period: next }).toString()); }
  function applyCustom(event: FormEvent) {
    event.preventDefault();
    if (!start || !end || end < start) { setError("تاریخ شروع و پایان معتبر انتخاب کنید."); return; }
    setQuery(new URLSearchParams({ period: "custom", start, end }).toString());
  }

  if (!permitted) return <section className="admin-section-state"><h1>آمار تخفیف‌ها</h1><p>نقش شما اجازه مشاهده آمار این کافه را ندارد.</p></section>;
  return <section className="analytics-page">
    <AnalyticsPeriodFilter period={period} start={start} end={end} onPeriodChange={selectPeriod} onStartChange={setStart} onEndChange={setEnd} onSubmit={applyCustom} />
    {unavailable ? <div className="analytics-state"><h2>آمار و تحلیل در اشتراک فعلی فعال نیست</h2><p>برای بررسی پلن‌های دارای این امکان، صفحه اشتراک را ببینید.</p><Link href="/admin/subscription">مشاهده پلن‌ها</Link></div>
      : error ? <div className="analytics-state" role="alert"><h2>گزارش تخفیف دریافت نشد</h2><p>{error}</p><Link href={`/admin/analytics?${query}&view=promotions`}>بازگشت به تخفیف‌ها</Link></div>
        : busy || !data ? <div className="analytics-loading" role="status"><span className="admin-spinner" />در حال آماده‌سازی گزارش…</div>
          : <PromotionDetailView data={data} rangeQuery={`${query}&view=promotions`} showOrdersLink={access.permissions.includes("orders.read")} />}
  </section>;
}
