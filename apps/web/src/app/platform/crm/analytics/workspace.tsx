"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePlatformSession } from "../../use-platform-session";
import { CrmShell } from "../workspace";

type Period = "today" | "last7Days" | "last30Days" | "currentMonth" | "previousMonth" | "currentQuarter" | "currentYear" | "custom";
type Filters = { period: Period; start: string; end: string; ownerId: string; source: string; expectedPlanId: string };
type Report = { data?: unknown; error?: string };
type Reports = Record<string, Report>;
type Owner = { id: string; label: string };
type Plan = { id: string; key: string; name: string };
type Metric = { value: number; previousValue?: number; changePercent?: number | null; isNew?: boolean };
type Overview = { generatedAt: string; period: { from: string; to: string; timezone: string }; metrics: Record<string, any> };
type Funnel = { stages: { key: string; label: string; value: number; fromPreviousRate: number | null }[]; leadsConvertedToOrganization: { value: number; rate: number | null } };
type Pipeline = { stages: { stage: string; openDeals: number; pipelineValueToman: string; visits: number; averageVisitDays: number | null; dealsEntered: number; dealsProgressed: number; progressionRate: number | null }[]; stalled: { thresholdDays: number; total: number; items: { id: string; title: string; stage: string; daysInStage: number; ownerLabel: string | null }[] } };
type Sources = { items: { source: string; leadsCreated: number; qualified: number; qualificationRate: number | null; dealsCreated: number; dealsWon: number; dealsLost: number; dealWinRate: number | null }[] };
type Work = { metrics: Record<string, number>; activitiesByType: { type: string; outcome: string | null; count: number }[]; activitySeries: { bucket: string; value: number }[] };
type Owners = { items: { id: string | null; label: string; leadsCreated: number; qualified: number; openDeals: number; won: number; lost: number; dealWinRate: number | null; activities: number; openTasks: number; overdueTasks: number }[] };
type Scoring = { bands: { band: string; label: string; leads: number; qualified: number; converted: number; observedConversionRate: number | null; averageFit: number | null; averageEngagement: number | null; averageOverall: number | null }[] };
type Automation = { summary: { executions: number; succeeded: number; failed: number; terminal: number; retriedExecutions: number; automationTasksCreated: number }; items: { workflowId: string; name: string; executions: number; succeeded: number; failed: number; terminal: number; retriedExecutions: number; automationTasksCreated: number; successRate: number | null }[] };
type Customers = { linkedOrganizations: number; activeTrials: number; activePaidCustomers: number; trialsStarted: number; completedTrials: number; trialToPaid: number; trialToPaidRate: number | null; averageTrialToPaidDays: number | null; plans: { planId: string; planName: string; customers: number }[] };

const fa = new Intl.NumberFormat("fa-IR");
const periods: { key: Period; label: string }[] = [
  { key: "today", label: "امروز" }, { key: "last7Days", label: "۷ روز اخیر" }, { key: "last30Days", label: "۳۰ روز اخیر" },
  { key: "currentMonth", label: "این ماه" }, { key: "previousMonth", label: "ماه گذشته" }, { key: "currentQuarter", label: "این فصل" },
  { key: "currentYear", label: "امسال" }, { key: "custom", label: "بازه دلخواه" },
];
const sources: Record<string, string> = { OUTBOUND_CALL: "تماس خروجی", LANDING_FORM: "فرم سایت", SEO: "جست‌وجوی گوگل", INSTAGRAM: "اینستاگرام", REFERRAL: "معرفی", SMS: "پیامک", PARTNER: "همکار تجاری", MANUAL: "ثبت دستی", OTHER: "سایر", UNKNOWN_DIRECT: "نامشخص / مستقیم" };
const stages: Record<string, string> = { DISCOVERY: "کشف نیاز", DEMO_SCHEDULED: "دموی زمان‌بندی‌شده", DEMO_COMPLETED: "دموی انجام‌شده", TRIAL_PROPOSED: "پیشنهاد آزمایشی", TRIAL_ACTIVE: "دوره آزمایشی", DECISION: "تصمیم خرید" };
const activityTypes: Record<string, string> = { CALL: "تماس", MEETING: "جلسه", DEMO: "دمو", EMAIL: "ایمیل", SMS: "پیامک", WHATSAPP: "واتس‌اپ", OTHER: "سایر" };
const outcomes: Record<string, string> = { CONNECTED: "پاسخ‌داده‌شده", NO_ANSWER: "بی‌پاسخ", BUSY: "مشغول", CALL_BACK_REQUESTED: "درخواست تماس دوباره", NOT_INTERESTED: "بی‌علاقه", INTERESTED: "علاقه‌مند", INVALID_NUMBER: "شماره نامعتبر", COMPLETED: "انجام‌شده", CANCELED: "لغوشده", NO_SHOW: "حاضر نشد", RESCHEDULED: "تغییر زمان" };

const defaultFilters: Filters = { period: "last30Days", start: "", end: "", ownerId: "", source: "", expectedPlanId: "" };
function todayInTehran() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}
function encode(values: Record<string, string>) { return new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""))).toString(); }
function count(value: unknown) { return Number(value ?? 0); }
function percent(value: number | null | undefined) { return value == null ? "—" : `${fa.format(value)}٪`; }
function money(value: string | number | null | undefined) {
  if (value == null) return "—";
  try { return `${fa.format(BigInt(value))} تومان`; } catch { return "—"; }
}
function date(value: string) { return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeZone: "Asia/Tehran" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)); }
function dateTime(value: string) { return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" }).format(new Date(value)); }
function bucketDate(value: string) { return value.includes("T") ? new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }).format(new Date(value)) : date(value); }
function previousLabel(metric?: Metric) {
  if (!metric) return "";
  if (metric.isNew) return "جدید نسبت به بازه قبل";
  if (metric.changePercent == null) return metric.previousValue === 0 ? "بدون مورد در بازه قبل" : "مقایسه در دسترس نیست";
  return `${metric.changePercent > 0 ? "＋" : ""}${percent(metric.changePercent)} نسبت به بازه قبل`;
}
function payload<T>(reports: Reports, name: string) { return reports[name]?.data as T | undefined; }

export function CrmAnalyticsWorkspace() {
  const { state, access, api } = usePlatformSession();
  const [filters, setFilters] = useState(defaultFilters);
  const [urlReady, setUrlReady] = useState(false);
  const [reports, setReports] = useState<Reports>({});
  const [owners, setOwners] = useState<Owner[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const canSeeCustomers = access.includes("subscriptions.read");
  const customRangeValid = filters.period !== "custom" || Boolean(filters.start && filters.end && filters.start <= filters.end);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selected = params.get("period");
    const period = periods.some((item) => item.key === selected) ? selected as Period : defaultFilters.period;
    setFilters({
      period,
      start: params.get("start") ?? "",
      end: params.get("end") ?? "",
      ownerId: params.get("ownerId") ?? "",
      source: params.get("source") ?? "",
      expectedPlanId: params.get("expectedPlanId") ?? "",
    });
    setUrlReady(true);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams({ period: filters.period });
    if (filters.period === "custom") { if (filters.start) params.set("start", filters.start); if (filters.end) params.set("end", filters.end); }
    if (filters.ownerId) params.set("ownerId", filters.ownerId);
    if (filters.source) params.set("source", filters.source);
    if (filters.expectedPlanId) params.set("expectedPlanId", filters.expectedPlanId);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
  }, [filters, urlReady]);

  const query = useMemo(() => encode({
    period: filters.period,
    start: filters.period === "custom" ? filters.start : "",
    end: filters.period === "custom" ? filters.end : "",
    ownerId: filters.ownerId,
    source: filters.source,
    expectedPlanId: filters.expectedPlanId,
    pipelineKey: "ucafe-default",
  }), [filters]);

  useEffect(() => {
    if (!urlReady || !customRangeValid || state !== "ready" || !access.includes("crm.read")) return;
    let cancelled = false;
    setLoading(true);
    const routes: [string, string][] = [
      ["overview", "/platform/crm/analytics/overview"], ["funnel", "/platform/crm/analytics/funnel"], ["pipeline", "/platform/crm/analytics/pipeline"], ["sources", "/platform/crm/analytics/sources"],
      ["work", "/platform/crm/analytics/work"], ["owners", "/platform/crm/analytics/owners"], ["scoring", "/platform/crm/analytics/scoring"], ["automation", "/platform/crm/analytics/automation"],
      ["ownersList", "/platform/crm/leads/assignees"], ["planList", "/platform/crm/deal-plans"],
    ];
    if (canSeeCustomers) routes.push(["customers", "/platform/crm/analytics/customers"]);
    void Promise.allSettled(routes.map(([, path]) => api<unknown>(`${path}?${query}`)))
      .then((results) => {
        if (cancelled) return;
        const next: Reports = {};
        results.forEach((result, index) => {
          const key = routes[index]![0];
          if (result.status === "fulfilled") {
            next[key] = { data: result.value };
            if (key === "ownersList") setOwners(result.value as Owner[]);
            if (key === "planList") setPlans(result.value as Plan[]);
            if (key === "overview") setUpdatedAt((result.value as Overview).generatedAt);
          } else next[key] = { error: (result.reason as Error).message || "گزارش بارگذاری نشد." };
        });
        setReports((current) => ({ ...current, ...next }));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [access, api, canSeeCustomers, customRangeValid, query, refresh, state, urlReady]);

  if (state === "loading") return <main className="platform-entry"><p>در حال بررسی دسترسی…</p></main>;
  if (state !== "ready" || !access.includes("crm.read")) return <main className="platform-entry"><section><h1>دسترسی CRM فعال نیست</h1><p>برای مشاهده تحلیل فروش به دسترسی crm.read نیاز دارید.</p><Link className="crm-button" href="/platform">بازگشت به پنل پلتفرم</Link></section></main>;

  const overview = payload<Overview>(reports, "overview");
  const funnel = payload<Funnel>(reports, "funnel");
  const pipeline = payload<Pipeline>(reports, "pipeline");
  const sourceReport = payload<Sources>(reports, "sources");
  const work = payload<Work>(reports, "work");
  const ownerReport = payload<Owners>(reports, "owners");
  const scoring = payload<Scoring>(reports, "scoring");
  const automation = payload<Automation>(reports, "automation");
  const customers = payload<Customers>(reports, "customers");
  const metrics = overview?.metrics ?? {};
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const retry = () => setRefresh((current) => current + 1);

  return <CrmShell canManage={access.includes("crm.manage")}>
    <div className="crm-analytics" aria-busy={loading}>
      <header className="crm-heading crm-analytics-heading"><div><p className="platform-nav-label"><Link href="/platform/crm">CRM</Link> / تحلیل فروش</p><h1>تحلیل فروش</h1><p>گزارش عملیاتی از سرنخ‌ها، فرصت‌ها و پیگیری‌های تیم UCafe.</p></div><div className="crm-analytics-freshness">{updatedAt ? <>به‌روزرسانی {dateTime(updatedAt)}</> : "گزارش زنده از داده‌های CRM"}<button type="button" onClick={retry} disabled={loading}>{loading ? "در حال دریافت…" : "به‌روزرسانی"}</button></div></header>

      <section className="crm-analytics-filters" aria-label="فیلترهای گزارش">
        <label>بازه زمانی<select value={filters.period} onChange={(event) => {
          const period = event.target.value as Period;
          setFilters((current) => ({ ...current, period, ...(period === "custom" ? { start: current.start || todayInTehran(), end: current.end || todayInTehran() } : {}) }));
        }}>{periods.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        {filters.period === "custom" && <><label>از تاریخ<input type="date" value={filters.start} onChange={(event) => setFilter("start", event.target.value)} /></label><label>تا تاریخ<input type="date" value={filters.end} onChange={(event) => setFilter("end", event.target.value)} /></label></>}
        <label>مسئول<select value={filters.ownerId} onChange={(event) => setFilter("ownerId", event.target.value)}><option value="">همه مسئولان</option><option value="UNASSIGNED">بدون مسئول</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.label}</option>)}</select></label>
        <label>منبع سرنخ<select value={filters.source} onChange={(event) => setFilter("source", event.target.value)}><option value="">همه منابع</option>{Object.entries(sources).filter(([key]) => key !== "UNKNOWN_DIRECT").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>پلن مورد انتظار فرصت<select value={filters.expectedPlanId} onChange={(event) => setFilter("expectedPlanId", event.target.value)}><option value="">همه پلن‌ها</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
        {filters.period === "custom" && !customRangeValid && <p className="crm-analytics-filter-error" role="alert">بازه دلخواه باید تاریخ شروع و پایان معتبر داشته باشد.</p>}
        <p className="crm-analytics-filter-note">منبع و پلن مورد انتظار برای گزارش سرنخ‌ها و فرصت‌ها اعمال می‌شوند؛ وظایف و فعالیت‌ها از مسئول فعلی و اجراکننده خود پیروی می‌کنند.</p>
      </section>

      <nav className="crm-analytics-nav" aria-label="بخش‌های تحلیل فروش">
        {["overview", "funnel", "pipeline", "sources", "work", "owners", "scoring", "automation", ...(canSeeCustomers ? ["customers"] : [])].map((section) => <a key={section} href={`#crm-analytics-${section}`}>{({ overview: "نمای کلی", funnel: "قیف فروش", pipeline: "خط فروش", sources: "منابع", work: "فعالیت و وظایف", owners: "تیم فروش", scoring: "امتیاز سرنخ", automation: "اتوماسیون", customers: "چرخه مشتری" } as Record<string, string>)[section]}</a>)}
      </nav>

      <section id="crm-analytics-overview" className="crm-analytics-section" aria-labelledby="crm-analytics-overview-title">
        <SectionHeading id="crm-analytics-overview-title" title="نمای کلی" description={overview ? `${date(overview.period.from)} تا ${date(overview.period.to)} · ${overview.period.timezone}` : "شاخص‌های کلیدی فروش در بازه انتخاب‌شده."} report={reports.overview} loading={loading} retry={retry} />
        {overview && <div className="crm-analytics-kpis">
          <Kpi title="سرنخ‌های جدید" value={fa.format(count(metrics.leadsCreated?.value))} compare={previousLabel(metrics.leadsCreated)} />
          <Kpi title="نرخ واجد شرایط شدن" value={percent(metrics.leadQualifiedRate?.value)} detail={`${fa.format(count(metrics.leadQualifiedRate?.numerator))} از ${fa.format(count(metrics.leadQualifiedRate?.denominator))} سرنخ بازه`} />
          <Kpi title="فرصت‌های باز" value={fa.format(count(metrics.openDeals))} detail="وضعیت فعلی فرصت‌ها" />
          <Kpi title="فرصت‌های برده‌شده" value={fa.format(count(metrics.wonDeals?.value))} compare={previousLabel(metrics.wonDeals)} />
          <Kpi title="ارزش خط فروش باز" value={money(metrics.openPipelineValueToman)} detail={`${fa.format(count(metrics.valuedOpenDeals))} فرصت دارای مبلغ · بدون وزن‌دهی`} />
          <Kpi title="وظایف عقب‌افتاده" value={fa.format(count(metrics.overdueTasks))} detail={`${fa.format(count(work?.metrics.overdueFollowUps))} مورد از نوع پیگیری`} />
          <Kpi title="میانگین چرخه فروش" value={metrics.averageWinSalesCycleDays == null ? "—" : `${fa.format(metrics.averageWinSalesCycleDays)} روز`} detail="از ثبت فرصت تا برد" />
          <Kpi title="نرخ برد فرصت‌ها" value={percent(metrics.dealWinRate?.value)} detail={`${fa.format(count(metrics.dealWinRate?.numerator))} برد از ${fa.format(count(metrics.dealWinRate?.denominator))} فرصت بسته‌شده`} />
        </div>}
      </section>

      <section id="crm-analytics-funnel" className="crm-analytics-section" aria-labelledby="crm-analytics-funnel-title">
        <SectionHeading id="crm-analytics-funnel-title" title="قیف فروش" description="هم‌گروه بر پایه تاریخ ایجاد سرنخ؛ هر سرنخ در هر مرحله فقط یک بار و بر اساس رسیدن دست‌کم یک‌باره شمارش می‌شود." report={reports.funnel} loading={loading} retry={retry} />
        {funnel && <><div className="crm-analytics-funnel">{funnel.stages.map((stage) => {
          const max = Math.max(1, ...funnel.stages.map((entry) => entry.value));
          return <div className="crm-analytics-funnel-row" key={stage.key}><div className="crm-analytics-funnel-label"><strong>{stage.label}</strong><b>{fa.format(stage.value)}</b></div><div className="crm-analytics-bar-track"><span style={{ width: `${Math.max(3, stage.value / max * 100)}%` }} /></div><small>{stage.fromPreviousRate == null ? "مبنای قیف" : `${percent(stage.fromPreviousRate)} از مرحله قبل`}</small></div>;
        })}</div><p className="crm-analytics-note">تبدیل سرنخ به سازمان: {fa.format(funnel.leadsConvertedToOrganization.value)} مورد · {percent(funnel.leadsConvertedToOrganization.rate)} از سرنخ‌های این گروه. این مرحله با مشتری پرداخت‌کننده یکی نیست.</p></>}
      </section>

      <section id="crm-analytics-pipeline" className="crm-analytics-section" aria-labelledby="crm-analytics-pipeline-title">
        <SectionHeading id="crm-analytics-pipeline-title" title="خط فروش و زمان ماندگاری" description="تعداد و مبلغ فرصت‌های باز، تصویری از وضعیت فعلی است؛ ورود به مرحله و زمان آن از تاریخچه همه بازدیدهای مرحله به دست می‌آید." report={reports.pipeline} loading={loading} retry={retry} />
        {pipeline && <><div className="crm-analytics-table-wrap" role="region" aria-label="گزارش مراحل خط فروش" tabIndex={0}><table className="crm-analytics-table"><thead><tr><th scope="col">مرحله</th><th scope="col">فرصت باز</th><th scope="col">ارزش تخمینی</th><th scope="col">بازدید مرحله</th><th scope="col">میانگین زمان هر بازدید</th><th scope="col">عبور از مرحله</th></tr></thead><tbody>{pipeline.stages.map((stage) => <tr key={stage.stage}><th scope="row">{stages[stage.stage] ?? stage.stage}</th><td>{fa.format(stage.openDeals)}</td><td>{money(stage.pipelineValueToman)}</td><td>{fa.format(stage.visits)}</td><td>{stage.averageVisitDays == null ? "—" : `${fa.format(stage.averageVisitDays)} روز`}</td><td>{fa.format(stage.dealsProgressed)} از {fa.format(stage.dealsEntered)} · {percent(stage.progressionRate)}</td></tr>)}</tbody></table></div>
          <div className="crm-analytics-stalled"><h3>فرصت‌های بدون پیشرفت</h3><p>مرحله در {fa.format(pipeline.stalled.thresholdDays)} روز اخیر تغییر نکرده و فعالیت مرتبطی هم در این مدت ثبت نشده است. موارد اولویت‌دار:</p><strong>{fa.format(pipeline.stalled.total)} فرصت</strong>
            {pipeline.stalled.items.length ? <ul>{pipeline.stalled.items.map((item) => <li key={item.id}><Link href={`/platform/crm/deals/${item.id}`}>{item.title}</Link><span>{stages[item.stage] ?? item.stage} · {fa.format(item.daysInStage)} روز · {item.ownerLabel ?? "بدون مسئول"}</span></li>)}</ul> : <p className="crm-analytics-empty">موردی با این تعریف پیدا نشد.</p>}</div></>}
      </section>

      <section id="crm-analytics-sources" className="crm-analytics-section" aria-labelledby="crm-analytics-sources-title">
        <SectionHeading id="crm-analytics-sources-title" title="کیفیت منابع" description="سرنخ‌ها بر اساس گروه ایجاد و فرصت‌ها بر اساس رویداد ایجاد/برد/باخت گزارش می‌شوند. نرخ برد مخرج فرصت‌های بسته‌شده است." report={reports.sources} loading={loading} retry={retry} />
        {sourceReport && <div className="crm-analytics-table-wrap" role="region" aria-label="گزارش عملکرد منابع سرنخ" tabIndex={0}><table className="crm-analytics-table"><thead><tr><th scope="col">منبع</th><th scope="col">سرنخ</th><th scope="col">واجد شرایط</th><th scope="col">نرخ احراز</th><th scope="col">فرصت ایجادشده</th><th scope="col">برد</th><th scope="col">باخت</th><th scope="col">نرخ برد</th></tr></thead><tbody>{sourceReport.items.filter((item) => item.leadsCreated || item.dealsCreated || item.dealsWon || item.dealsLost).map((item) => <tr key={item.source}><th scope="row">{sources[item.source] ?? item.source}</th><td>{fa.format(item.leadsCreated)}</td><td>{fa.format(item.qualified)}</td><td>{percent(item.qualificationRate)}</td><td>{fa.format(item.dealsCreated)}</td><td>{fa.format(item.dealsWon)}</td><td>{fa.format(item.dealsLost)}</td><td>{percent(item.dealWinRate)}</td></tr>)}</tbody></table>{sourceReport.items.every((item) => !item.leadsCreated && !item.dealsCreated && !item.dealsWon && !item.dealsLost) && <p className="crm-analytics-empty">در این بازه رویدادی ثبت نشده است.</p>}</div>}
        {sourceReport && <p className="crm-analytics-note">فرصت به منبع سرنخ مبدأ نسبت داده می‌شود؛ فرصت بدون سرنخ مبدأ در «نامشخص / مستقیم» قرار می‌گیرد. نسبت‌دادن مشتری پرداخت‌کننده به منبع سرنخ، به‌دلیل نبود پیوند قطعی چندسرنخی، نمایش داده نمی‌شود.</p>}
      </section>

      <section id="crm-analytics-work" className="crm-analytics-section" aria-labelledby="crm-analytics-work-title">
        <SectionHeading id="crm-analytics-work-title" title="فعالیت و پیگیری‌ها" description="فعالیت با زمان وقوع و اجراکننده خودش؛ وظایف از مسئول فعلی و رویدادهای تکمیل ثبت‌شده گزارش می‌شوند." report={reports.work} loading={loading} retry={retry} />
        {work && <><div className="crm-analytics-kpis crm-analytics-kpis-compact">
          <Kpi title="فعالیت‌ها" value={fa.format(count(work.metrics.activities))} detail="بر اساس زمان وقوع" />
          <Kpi title="وظایف باز" value={fa.format(count(work.metrics.openTasks))} detail={`${fa.format(count(work.metrics.overdueTasks))} عقب‌افتاده`} />
          <Kpi title="پیگیری‌های باز" value={fa.format(count(work.metrics.openFollowUps))} detail={`${fa.format(count(work.metrics.overdueFollowUps))} عقب‌افتاده`} />
          <Kpi title="تکمیل از وظایف موعددار" value={percent(count(work.metrics.dueTasks) ? count(work.metrics.completedDueTasks) / count(work.metrics.dueTasks) * 100 : null)} detail={`${fa.format(count(work.metrics.completedDueTasks))} تکمیل‌شده از ${fa.format(count(work.metrics.dueTasks))} وظیفه موعددار`} />
        </div>
          <div className="crm-analytics-split"><div><h3>فعالیت به تفکیک نوع و نتیجه</h3>{work.activitiesByType.length ? <ul className="crm-analytics-breakdown">{work.activitiesByType.map((item) => <li key={`${item.type}:${item.outcome}`}><span>{activityTypes[item.type] ?? item.type}{item.outcome ? ` · ${outcomes[item.outcome] ?? item.outcome}` : ""}</span><b>{fa.format(item.count)}</b></li>)}</ul> : <p className="crm-analytics-empty">فعالیتی در این بازه ثبت نشده است.</p>}</div>
            <div><h3>روند فعالیت</h3>{work.activitySeries.some((item) => item.value > 0) ? <div className="crm-analytics-series">{work.activitySeries.map((item) => { const max = Math.max(1, ...work.activitySeries.map((point) => point.value)); return <div key={item.bucket}><span>{bucketDate(item.bucket)}</span><div className="crm-analytics-bar-track"><span style={{ width: `${Math.max(item.value ? 3 : 0, item.value / max * 100)}%` }} /></div><b>{fa.format(item.value)}</b></div>; })}</div> : <p className="crm-analytics-empty">فعالیتی در این بازه ثبت نشده است.</p>}</div></div>
          <p className="crm-analytics-note">نرخ تکمیل، تعداد وظایف غیرلغوشده با نخستین رویداد تکمیل ثبت‌شده را بر وظایف غیرلغوشده‌ای تقسیم می‌کند که تاریخ سررسید فعلی‌شان در بازه است. نرخ «به‌موقع» نیست؛ تغییرات تاریخی سررسید ثبت نمی‌شوند.</p>
        </>}
      </section>

      <section id="crm-analytics-owners" className="crm-analytics-section" aria-labelledby="crm-analytics-owners-title">
        <SectionHeading id="crm-analytics-owners-title" title="تیم فروش" description="مالک فعلی سرنخ/فرصت، اجراکننده فعالیت و مسئول فعلی وظیفه سه نقش جدا هستند؛ داده‌ها رتبه‌بندی یا امتیازدهی نمی‌شوند." report={reports.owners} loading={loading} retry={retry} />
        {ownerReport && <div className="crm-analytics-table-wrap" role="region" aria-label="گزارش کار تیم فروش" tabIndex={0}><table className="crm-analytics-table"><thead><tr><th scope="col">مسئول</th><th scope="col">سرنخ ثبت‌شده</th><th scope="col">واجد شرایط</th><th scope="col">فرصت باز</th><th scope="col">برد / باخت</th><th scope="col">نرخ برد</th><th scope="col">فعالیت اجراشده</th><th scope="col">وظیفه باز / عقب‌افتاده</th></tr></thead><tbody>{ownerReport.items.map((item) => <tr key={item.id ?? "unassigned"}><th scope="row">{item.label}</th><td>{fa.format(item.leadsCreated)}</td><td>{fa.format(item.qualified)}</td><td>{fa.format(item.openDeals)}</td><td>{fa.format(item.won)} / {fa.format(item.lost)}</td><td>{percent(item.dealWinRate)} <small>({fa.format(item.won + item.lost)} بسته‌شده)</small></td><td>{fa.format(item.activities)}</td><td>{fa.format(item.openTasks)} / {fa.format(item.overdueTasks)}</td></tr>)}</tbody></table>{ownerReport.items.length === 0 && <p className="crm-analytics-empty">برای این بازه داده‌ای از تیم ثبت نشده است.</p>}</div>}
      </section>

      <section id="crm-analytics-scoring" className="crm-analytics-section" aria-labelledby="crm-analytics-scoring-title">
        <SectionHeading id="crm-analytics-scoring-title" title="امتیاز سرنخ" description="توزیع و نتیجه مشاهده‌شده بر اساس گروه ایجاد سرنخ؛ امتیازها قواعد داخلی‌اند و احتمال تبدیل نیستند." report={reports.scoring} loading={loading} retry={retry} />
        {scoring && <><div className="crm-analytics-table-wrap" role="region" aria-label="گزارش امتیازدهی سرنخ‌ها" tabIndex={0}><table className="crm-analytics-table"><thead><tr><th scope="col">گروه امتیاز</th><th scope="col">سرنخ</th><th scope="col">واجد شرایط فعلی</th><th scope="col">تبدیل‌شده</th><th scope="col">نرخ تبدیل مشاهده‌شده</th><th scope="col">میانگین تناسب</th><th scope="col">میانگین تعامل</th><th scope="col">میانگین کل</th></tr></thead><tbody>{scoring.bands.filter((item) => item.leads > 0).map((item) => <tr key={item.band}><th scope="row">{item.label}</th><td>{fa.format(item.leads)}</td><td>{fa.format(item.qualified)}</td><td>{fa.format(item.converted)}</td><td>{percent(item.observedConversionRate)}</td><td>{item.averageFit == null ? "—" : fa.format(item.averageFit)}</td><td>{item.averageEngagement == null ? "—" : fa.format(item.averageEngagement)}</td><td>{item.averageOverall == null ? "—" : fa.format(item.averageOverall)}</td></tr>)}</tbody></table>{scoring.bands.every((item) => item.leads === 0) && <p className="crm-analytics-empty">برای این بازه امتیازی ثبت نشده است.</p>}</div><p className="crm-analytics-note">سرنخ تبدیل‌شده آخرین امتیاز ذخیره‌شده‌اش را نگه می‌دارد؛ سرنخ‌های دیگر از امتیاز فعلی استفاده می‌کنند. تغییرات تاریخی قواعد امتیازدهی بازسازی نمی‌شوند.</p></>}
      </section>

      <section id="crm-analytics-automation" className="crm-analytics-section" aria-labelledby="crm-analytics-automation-title">
        <SectionHeading id="crm-analytics-automation-title" title="اتوماسیون" description="آمار توصیفی اجرای گردش‌کارها بر اساس زمان ایجاد اجرا؛ اثر علّی بر تبدیل یا فروش ادعا نمی‌شود." report={reports.automation} loading={loading} retry={retry} />
        {automation && <><div className="crm-analytics-kpis crm-analytics-kpis-compact"><Kpi title="اجراها" value={fa.format(automation.summary.executions)} /><Kpi title="موفق / ناموفق" value={`${fa.format(automation.summary.succeeded)} / ${fa.format(automation.summary.failed)}`} detail={`${fa.format(automation.summary.terminal)} اجرای نهایی`} /><Kpi title="نیازمند تلاش مجدد" value={fa.format(automation.summary.retriedExecutions)} /><Kpi title="وظایف ایجادشده با اتوماسیون" value={fa.format(automation.summary.automationTasksCreated)} /></div>
          <div className="crm-analytics-table-wrap" role="region" aria-label="گزارش گردش‌کارها" tabIndex={0}><table className="crm-analytics-table"><thead><tr><th scope="col">گردش‌کار</th><th scope="col">اجرا</th><th scope="col">موفق</th><th scope="col">ناموفق</th><th scope="col">نرخ موفقیت</th><th scope="col">نیازمند تلاش مجدد</th><th scope="col">وظیفه خودکار</th></tr></thead><tbody>{automation.items.map((item) => <tr key={item.workflowId}><th scope="row">{item.name}</th><td>{fa.format(item.executions)}</td><td>{fa.format(item.succeeded)}</td><td>{fa.format(item.failed)}</td><td>{percent(item.successRate)} <small>({fa.format(item.terminal)} اجرای نهایی)</small></td><td>{fa.format(item.retriedExecutions)}</td><td>{fa.format(item.automationTasksCreated)}</td></tr>)}</tbody></table>{automation.items.length === 0 && <p className="crm-analytics-empty">در این بازه اجرایی ثبت نشده است.</p>}</div>
        </>}
      </section>

      <section id="crm-analytics-customers" className="crm-analytics-section" aria-labelledby="crm-analytics-customers-title">
        <SectionHeading id="crm-analytics-customers-title" title="چرخه مشتری" description="داده‌های اشتراک فقط برای سازمان‌های CRM متصل و فعال؛ وضعیت مؤثر از منطق رسمی اشتراک خوانده می‌شود." report={canSeeCustomers ? reports.customers : undefined} loading={loading} retry={retry} />
        {!canSeeCustomers ? <p className="crm-analytics-empty">برای مشاهده شاخص‌های اشتراک، دسترسی subscriptions.read لازم است.</p> : customers && <><div className="crm-analytics-kpis crm-analytics-kpis-compact"><Kpi title="سازمان متصل به اشتراک" value={fa.format(customers.linkedOrganizations)} /><Kpi title="دوره آزمایشی فعال" value={fa.format(customers.activeTrials)} /><Kpi title="مشتری پرداخت‌کننده فعال" value={fa.format(customers.activePaidCustomers)} /><Kpi title="نرخ تبدیل آزمایش به پرداخت" value={percent(customers.trialToPaidRate)} detail={`${fa.format(customers.trialToPaid)} تبدیل از ${fa.format(customers.completedTrials)} دوره تکمیل‌شده`} /></div>
          <p className="crm-analytics-note">در این بازه {fa.format(customers.trialsStarted)} دوره آزمایشی شروع شده است. میانگین زمان تبدیل ثبت‌شده: {customers.averageTrialToPaidDays == null ? "—" : `${fa.format(customers.averageTrialToPaidDays)} روز`}. آغاز آزمایش بر اساس تاریخ شروع اشتراک و پرداخت بر اساس اولین پرداخت موفق TRIAL_TO_PAID است؛ مشتری نیازمند اشتراک مؤثر فعال و پرداخت موفق غیرقدیمی است.</p>
          <div className="crm-analytics-plan-list"><h3>پلن فعلی مشتریان فعال</h3>{customers.plans.length ? customers.plans.map((plan) => <div key={plan.planId}><span>{plan.planName}</span><b>{fa.format(plan.customers)}</b></div>) : <p className="crm-analytics-empty">مشتری پرداخت‌کننده فعالی پیدا نشد.</p>}</div>
          <p className="crm-analytics-note">ارتباط سرنخ یا فرصت برنده‌شده با شروع آزمایش/پرداخت به‌صورت قطعی ذخیره نمی‌شود؛ بنابراین تبدیل مشتری به منبع سرنخ نسبت داده نشده است.</p>
        </>}
      </section>
    </div>
  </CrmShell>;
}

function SectionHeading({ id, title, description, report, loading, retry }: { id: string; title: string; description: string; report?: Report; loading: boolean; retry: () => void }) {
  return <header className="crm-analytics-section-heading"><div><h2 id={id}>{title}</h2><p>{description}</p></div>{report?.error && <span className="crm-analytics-section-error" role="status">این بخش بارگیری نشد. <button type="button" onClick={retry}>تلاش دوباره</button></span>}{loading && <span className="crm-analytics-loading" role="status">در حال دریافت…</span>}</header>;
}

function Kpi({ title, value, detail, compare }: { title: string; value: string; detail?: string; compare?: string }) {
  return <article className="crm-analytics-kpi"><h3>{title}</h3><strong>{value}</strong>{detail && <p>{detail}</p>}{compare && <small>{compare}</small>}</article>;
}
