"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PlatformApi as Api } from "../use-platform-session";

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type Activity = { id: string; activityType: string; subject: string; outcome: string | null; occurredAt: string; contactName: string | null; actorLabel: string | null };
type Task = { id: string; title: string; kind: string; status: string; priority: string; dueAt: string | null; assigneeLabel: string | null; overdue: boolean };
type Overview = {
  summary: { contactCount: number | null; leadCount: number | null; dealCount: number | null; openDealCount: number | null; openTaskCount: number | null; lastActivity: Activity | null; nextTask: Task | null };
  leads: { id: string; businessName: string; status: string; source: string; ownerLabel: string | null; primaryContactName: string | null; archivedAt: string | null; createdAt: string }[];
  deals: { id: string; title: string; stage: string; status: string; expectedPlanName: string | null; estimatedAmountToman: string | null; expectedCloseDate: string | null; ownerLabel: string | null; primaryContactName: string | null; archivedAt: string | null }[];
  openTasks: Task[];
  recentActivities: (Activity & { details: string | null; dealId: string | null; dealTitle: string | null })[];
  recentNotes: { id: string; body: string; createdAt: string; authorLabel: string | null; archivedAt: string | null }[];
  sectionErrors: string[];
};
type TimelineItem = {
  id: string; type: string; category: string; occurredAt: string;
  actor: { userId: string | null; label: string | null; kind: string };
  title: string; description: string | null; organizationId: string; contactId: string | null; leadId: string | null; dealId: string | null;
  sourceType: string; sourceId: string; metadata: Record<string, unknown> | null;
};
type Tenant = { id: string; name: string; slug: string; status: string; hostname: string | null; createdAt: string; publishedAt: string | null; suspendedAt: string | null; archivedAt: string | null; deletedAt: string | null };
type Subscription = { status: string; plan: { key: string; name: string }; trial: { status: string; startedAt: string; endsAt: string | null; daysRemaining: number } | null; currentPeriodStartedAt: string | null; currentPeriodEndsAt: string | null; graceEndsAt: string | null; graceDaysRemaining: number | null; pendingChange: { plan: { key: string; name: string }; effectiveAt: string | null } | null };
type CustomerContext = { tenantId: string | null; tenant: Tenant | null; subscription: Subscription | null; sectionErrors: string[] };
type TenantOption = Pick<Tenant, "id" | "name" | "slug" | "status" | "hostname">;

const fa = new Intl.NumberFormat("fa-IR");
const count = (value: number | null | undefined) => value === null || value === undefined ? "—" : fa.format(value);
const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "بدون موعد";
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(value)) : "—";
const stageNames: Record<string, string> = { DISCOVERY: "شناخت اولیه", DEMO_SCHEDULED: "نمایش محصول", DEMO_COMPLETED: "نمایش انجام‌شده", TRIAL_PROPOSED: "پیشنهاد آزمایشی", TRIAL_ACTIVE: "دوره آزمایشی", DECISION: "تصمیم‌گیری" };
const lossReasonNames: Record<string, string> = { PRICE: "قیمت", TIMING: "زمان‌بندی", PRODUCT_FIT: "تناسب محصول", NO_RESPONSE: "بی‌پاسخ", COMPETITOR: "رقیب", OTHER: "سایر" };
const statusNames: Record<string, string> = { NEW: "جدید", ATTEMPTING_CONTACT: "در حال تماس", CONTACTED: "تماس‌گرفته‌شده", QUALIFIED: "واجد شرایط", NURTURING: "در حال پیگیری", UNQUALIFIED: "نامرتبط", CONVERTED: "تبدیل‌شده", OPEN: "باز", WON: "برنده", LOST: "از دست‌رفته" };
const sourceNames: Record<string, string> = { OUTBOUND_CALL: "تماس خروجی", LANDING_FORM: "فرم مشاوره عمومی", SEO: "جست‌وجو", INSTAGRAM: "اینستاگرام", REFERRAL: "معرفی", SMS: "پیامک", PARTNER: "همکار", MANUAL: "ثبت دستی", OTHER: "سایر" };
const activityNames: Record<string, string> = { CALL: "تماس", MEETING: "جلسه", DEMO: "نمایش محصول", EMAIL: "ایمیل", SMS: "پیامک", WHATSAPP: "واتس‌اپ", OTHER: "تعامل" };
const outcomeNames: Record<string, string> = { CONNECTED: "تماس برقرار شد", NO_ANSWER: "پاسخی نداد", BUSY: "خط اشغال بود", CALL_BACK_REQUESTED: "درخواست تماس دوباره", NOT_INTERESTED: "علاقه‌مند نبود", INTERESTED: "علاقه‌مند بود", INVALID_NUMBER: "شماره نامعتبر", COMPLETED: "انجام شد", CANCELED: "لغو شد", NO_SHOW: "حضور نداشت", RESCHEDULED: "به زمان دیگری موکول شد", OTHER: "سایر" };
const money = (value?: string | null) => value === null || value === undefined ? "بدون برآورد" : `${fa.format(Number(value))} تومان`;
const categoryNames: Record<string, string> = { LEAD: "سرنخ", DEAL: "فرصت", ACTIVITY: "فعالیت", TASK: "وظیفه", NOTE: "یادداشت", CUSTOMER: "مشتری UCafe" };
const subscriptionStatusNames: Record<string, string> = { TRIALING: "دوره آزمایشی", ACTIVE: "فعال", GRACE: "مهلت تمدید", SUSPENDED: "تعلیق‌شده", CANCELED: "لغوشده" };
const trialStatusNames: Record<string, string> = { ACTIVE: "فعال", CONVERTED: "تبدیل به اشتراک", ENDED: "پایان‌یافته", CANCELED: "لغوشده" };
const tenantStatusNames: Record<string, string> = { DRAFT: "پیش‌نویس", PREVIEW: "آزمایشی", ACTIVE: "فعال", SUSPENDED: "تعلیق‌شده", ARCHIVED: "بایگانی" };

export function Organization360({ api, organizationId, canLinkTenant, canViewCustomerContext, canViewTenant, canCreateTenant, organizationArchived, onTenantLinkChanged }: { api: Api; organizationId: string; canLinkTenant: boolean; canViewCustomerContext: boolean; canViewTenant: boolean; canCreateTenant: boolean; organizationArchived: boolean; onTenantLinkChanged: () => Promise<void> }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [category, setCategory] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [timeline, setTimeline] = useState<Page<TimelineItem>>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState("");
  const [customer, setCustomer] = useState<CustomerContext | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [showTenantPicker, setShowTenantPicker] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [tenantActionError, setTenantActionError] = useState("");
  const [tenantActionBusy, setTenantActionBusy] = useState(false);

  const loadCustomer = useCallback(async () => {
    if (!canViewCustomerContext) return;
    setCustomerLoading(true); setCustomerError("");
    try { setCustomer(await api<CustomerContext>(`/platform/crm/organizations/${organizationId}/customer-context`)); }
    catch (reason) { setCustomerError((reason as Error).message); }
    finally { setCustomerLoading(false); }
  }, [api, canViewCustomerContext, organizationId]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true); setOverviewError("");
    try { setOverview(await api<Overview>(`/platform/crm/organizations/${organizationId}/overview`)); }
    catch (reason) { setOverviewError((reason as Error).message); }
    finally { setOverviewLoading(false); }
  }, [api, organizationId]);
  const loadTimeline = useCallback(async () => {
    if (!canViewCustomerContext) return;
    setTimelineLoading(true); setTimelineError("");
    const dateToBoundary = dateTo ? new Date(`${dateTo}T00:00:00`) : null;
    if (dateToBoundary) dateToBoundary.setDate(dateToBoundary.getDate() + 1);
    const query = new URLSearchParams({
      page: String(page), pageSize: "20", ...(category ? { category } : {}),
      ...(dateFrom ? { dateFrom: new Date(`${dateFrom}T00:00:00`).toISOString() } : {}),
      ...(dateToBoundary ? { dateTo: dateToBoundary.toISOString() } : {}),
    });
    try { setTimeline(await api<Page<TimelineItem>>(`/platform/crm/organizations/${organizationId}/timeline?${query}`)); }
    catch (reason) { setTimelineError((reason as Error).message); }
    finally { setTimelineLoading(false); }
  }, [api, category, canViewCustomerContext, dateFrom, dateTo, organizationId, page]);
  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadTimeline(); }, [loadTimeline]);
  useEffect(() => { void loadCustomer(); }, [loadCustomer]);

  async function openTenantPicker() {
    setTenantActionError(""); setShowTenantPicker(true);
    if (tenantOptions.length) return;
    try { setTenantOptions(await api<TenantOption[]>(`/platform/crm/tenant-link-candidates?organizationId=${organizationId}`)); }
    catch (reason) { setTenantActionError((reason as Error).message); }
  }
  async function changeTenantLink(method: "POST" | "DELETE") {
    setTenantActionBusy(true); setTenantActionError("");
    try {
      await api(`/platform/crm/organizations/${organizationId}/tenant-link`, { method, ...(method === "POST" ? { body: JSON.stringify({ coffeeShopId: selectedTenantId }) } : {}) });
      setShowTenantPicker(false); setSelectedTenantId("");
      await Promise.all([loadCustomer(), loadTimeline(), onTenantLinkChanged()]);
    } catch (reason) { setTenantActionError((reason as Error).message); }
    finally { setTenantActionBusy(false); }
  }

  return <div className="crm-360">
    <nav className="crm-360-nav" aria-label="بخش‌های سازمان">
      {canViewCustomerContext && <a href="#crm-360-customer">مشتری UCafe</a>}<a href="#crm-360-overview">نمای کلی</a><a href="#crm-contacts">ارتباط‌ها</a><a href="#crm-360-leads">سرنخ‌ها</a>
      <a href="#crm-360-deals">فرصت‌ها</a><a href="#crm-work">کارهای CRM</a>{canViewCustomerContext && <a href="#crm-360-timeline">تاریخچه</a>}
    </nav>
    {canViewCustomerContext && <section className="crm-360-list" id="crm-360-customer" aria-labelledby="crm-360-customer-title">
      <header><div><p>اطلاعات زنده از سامانه اشتراک</p><h2 id="crm-360-customer-title">مشتری UCafe</h2></div>{customer?.tenant && canViewTenant && <Link href={`/platform?view=tenants&tenantId=${customer.tenant.id}`}>رفتن به پرونده کافه</Link>}</header>
      {customerLoading && !customer ? <p className="crm-360-state" role="status">در حال دریافت اطلاعات کافه و اشتراک…</p> : customerError && !customer ? <p className="crm-360-state crm-360-error" role="alert">اطلاعات مشتری بارگذاری نشد. <button type="button" onClick={() => void loadCustomer()}>تلاش دوباره</button></p> : customer && <>
        {customerError && <p className="crm-360-state crm-360-error" role="status">به‌روزرسانی اطلاعات مشتری انجام نشد؛ داده قبلی نمایش داده می‌شود.</p>}
        {customer.sectionErrors.includes("tenant") ? <p className="crm-360-state crm-360-error" role="status">اطلاعات کافه بارگذاری نشد؛ وضعیت پیوند قابل بررسی نیست.</p> : !customer.tenant ? <div className="crm-360-state"><p>هنوز کافه‌ای به این سازمان پیوند نخورده است.</p>{canLinkTenant && !organizationArchived && <div className="crm-actions">{canCreateTenant && <Link className="crm-button" href="/platform?view=new">افزودن کافه در UCafe</Link>}{!showTenantPicker ? <button type="button" onClick={() => void openTenantPicker()}>پیوند به کافه موجود</button> : <><label>انتخاب کافه<select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}><option value="">انتخاب کنید</option>{tenantOptions.map((tenant) => <option value={tenant.id} key={tenant.id}>{tenant.name} · {tenant.hostname ?? tenant.slug} · {tenantStatusNames[tenant.status] ?? tenant.status}</option>)}</select></label><button type="button" disabled={!selectedTenantId || tenantActionBusy} onClick={() => void changeTenantLink("POST")}>{tenantActionBusy ? "در حال پیوند…" : "پیوند کافه"}</button><button type="button" onClick={() => setShowTenantPicker(false)}>انصراف</button></>}</div>}{tenantActionError && <p className="message error" role="alert">{tenantActionError}</p>}</div> : <div className="crm-360-columns">
          <section className="crm-360-list"><header><div><h3>{customer.tenant.name}</h3><span className={`badge ${customer.tenant.status.toLowerCase()}`}>{tenantStatusNames[customer.tenant.status] ?? customer.tenant.status}</span></div></header><dl className="crm-facts"><div><dt>دامنه</dt><dd dir="ltr">{customer.tenant.hostname ?? customer.tenant.slug}</dd></div><div><dt>ثبت در UCafe</dt><dd>{formatDate(customer.tenant.createdAt)}</dd></div><div><dt>انتشار</dt><dd>{formatDate(customer.tenant.publishedAt)}</dd></div><div><dt>تعلیق</dt><dd>{formatDate(customer.tenant.suspendedAt)}</dd></div><div><dt>بایگانی</dt><dd>{formatDate(customer.tenant.archivedAt ?? customer.tenant.deletedAt)}</dd></div></dl>{canLinkTenant && <button className="crm-danger" type="button" disabled={tenantActionBusy} onClick={() => { if (window.confirm("این کافه از سازمان CRM جدا شود؟ اطلاعات کافه در UCafe باقی می‌ماند.")) void changeTenantLink("DELETE"); }}>{tenantActionBusy ? "در حال جداسازی…" : "جداسازی کافه از سازمان"}</button>}{tenantActionError && <p className="message error" role="alert">{tenantActionError}</p>}</section>
          <section className="crm-360-list"><header><div><h3>اشتراک و دوره آزمایشی</h3></div></header>{customer.sectionErrors.includes("subscription") ? <p className="crm-360-state crm-360-error" role="status">وضعیت اشتراک بارگذاری نشد.</p> : customer.subscription ? <dl className="crm-facts"><div><dt>پلن فعلی</dt><dd>{customer.subscription.plan.name} · {subscriptionStatusNames[customer.subscription.status] ?? customer.subscription.status}</dd></div><div><dt>بازه فعلی</dt><dd>{formatDate(customer.subscription.currentPeriodStartedAt)} تا {formatDate(customer.subscription.currentPeriodEndsAt)}</dd></div>{customer.subscription.trial && <div><dt>دوره آزمایشی</dt><dd>{trialStatusNames[customer.subscription.trial.status] ?? customer.subscription.trial.status} · {formatDate(customer.subscription.trial.startedAt)} تا {formatDate(customer.subscription.trial.endsAt)}{customer.subscription.trial.status === "ACTIVE" ? ` · ${count(customer.subscription.trial.daysRemaining)} روز باقی‌مانده` : ""}</dd></div>}{customer.subscription.graceEndsAt && <div><dt>مهلت تمدید</dt><dd>تا {formatDate(customer.subscription.graceEndsAt)} · {count(customer.subscription.graceDaysRemaining)} روز باقی‌مانده</dd></div>}{customer.subscription.pendingChange && <div><dt>تغییر زمان‌بندی‌شده</dt><dd>{customer.subscription.pendingChange.plan.name} از {formatDate(customer.subscription.pendingChange.effectiveAt)}</dd></div>}</dl> : <p className="crm-360-state">برای این کافه اشتراکی ثبت نشده است.</p>}</section>
        </div>}
      </>}
    </section>}
    <section className="crm-360-overview" id="crm-360-overview" aria-labelledby="crm-360-overview-title">
      <header className="crm-360-heading"><div><p>نمای رابطه</p><h2 id="crm-360-overview-title">خلاصه ارتباط</h2></div><a href="#crm-work">ثبت فعالیت یا پیگیری</a></header>
      {overviewLoading && !overview ? <p className="crm-360-state" role="status">در حال دریافت نمای سازمان…</p> : overviewError && !overview ? <p className="crm-360-state crm-360-error" role="alert">نمای سازمان بارگذاری نشد. <button type="button" onClick={() => void loadOverview()}>تلاش دوباره</button></p> : overview && <>
        {overviewError && <p className="crm-360-state crm-360-error" role="status">به‌روزرسانی نمای سازمان انجام نشد؛ داده قبلی نمایش داده می‌شود.</p>}
        {overview.sectionErrors.includes("summary") && <p className="crm-360-state crm-360-error" role="status">بخشی از شمارنده‌های خلاصه بارگذاری نشد.</p>}
        <div className="crm-360-metrics">
          <a href="#crm-contacts"><strong>{count(overview.summary.contactCount)}</strong><span>ارتباط فعال</span></a>
          <a href="#crm-360-leads"><strong>{count(overview.summary.leadCount)}</strong><span>سرنخ</span></a>
          <a href="#crm-360-deals"><strong>{count(overview.summary.openDealCount)}</strong><span>فرصت باز</span></a>
          <a href="#crm-work"><strong>{count(overview.summary.openTaskCount)}</strong><span>وظیفه باز</span></a>
        </div>
        <div className="crm-360-highlights">
          <article><small>آخرین فعالیت</small>{overview.summary.lastActivity ? <><strong>{activityNames[overview.summary.lastActivity.activityType] ?? "تعامل"} · {overview.summary.lastActivity.subject}</strong><time dateTime={overview.summary.lastActivity.occurredAt}>{dateTime(overview.summary.lastActivity.occurredAt)}</time></> : <p>{overview.sectionErrors.includes("activities") ? "فعالیت‌ها بارگذاری نشدند." : "هنوز فعالیتی ثبت نشده است."}</p>}</article>
          <article><small>اقدام بعدی</small>{overview.summary.nextTask ? <><strong><a href="#crm-work">{overview.summary.nextTask.title}</a></strong><time dateTime={overview.summary.nextTask.dueAt ?? undefined}>{overview.summary.nextTask.overdue ? "عقب‌افتاده" : dateTime(overview.summary.nextTask.dueAt)}</time><span>{overview.summary.nextTask.assigneeLabel ?? "بدون مسئول"}</span></> : <p>{overview.sectionErrors.includes("tasks") ? "وظایف بارگذاری نشدند." : "وظیفه بازی برای این سازمان نیست."}</p>}</article>
        </div>
      </>}
    </section>

    <div className="crm-360-columns">
      <section className="crm-360-list" id="crm-360-leads" aria-labelledby="crm-360-leads-title">
        <header><div><h2 id="crm-360-leads-title">سرنخ‌های مرتبط</h2><span>{count(overview?.summary.leadCount)}</span></div><Link href="/platform/crm/leads">همه سرنخ‌ها</Link></header>
        {overviewLoading && !overview ? <p className="crm-360-state">در حال دریافت…</p> : overviewError && !overview ? <p className="crm-360-state crm-360-error" role="status">نمای سازمان در دسترس نیست.</p> : overview?.sectionErrors.includes("leads") ? <p className="crm-360-state crm-360-error" role="status">سرنخ‌ها بارگذاری نشدند.</p> : !overview?.leads.length ? <p className="crm-360-state">سرنخی به این سازمان پیوند نخورده است.</p> : <ul>{overview.leads.map((lead) => <li key={lead.id}><Link href={`/platform/crm/leads/${lead.id}`}><strong>{lead.businessName}</strong><span>{statusNames[lead.status] ?? lead.status} · {sourceNames[lead.source] ?? lead.source}</span></Link><small>{lead.ownerLabel ?? "بدون مسئول"}{lead.archivedAt ? " · بایگانی‌شده" : ""}</small></li>)}</ul>}
      </section>
      <section className="crm-360-list" id="crm-360-deals" aria-labelledby="crm-360-deals-title">
        <header><div><h2 id="crm-360-deals-title">فرصت‌ها</h2><span>{count(overview?.summary.dealCount)}</span></div><Link href="/platform/crm/deals">همه فرصت‌ها</Link></header>
        {overviewLoading && !overview ? <p className="crm-360-state">در حال دریافت…</p> : overviewError && !overview ? <p className="crm-360-state crm-360-error" role="status">نمای سازمان در دسترس نیست.</p> : overview?.sectionErrors.includes("deals") ? <p className="crm-360-state crm-360-error" role="status">فرصت‌ها بارگذاری نشدند.</p> : !overview?.deals.length ? <p className="crm-360-state">هنوز فرصتی ثبت نشده است.</p> : <ul>{overview.deals.map((deal) => <li key={deal.id}><Link href={`/platform/crm/deals/${deal.id}`}><strong>{deal.title}</strong><span>{stageNames[deal.stage] ?? deal.stage} · {statusNames[deal.status] ?? deal.status}{deal.archivedAt ? " · بایگانی‌شده" : ""}</span></Link><small>طرح مورد انتظار: {deal.expectedPlanName ?? "ثبت‌نشده"} · برآورد: {money(deal.estimatedAmountToman)}</small></li>)}</ul>}
      </section>
    </div>

    {overview && <div className="crm-360-columns crm-360-recent">
      <section className="crm-360-list" id="crm-360-open-tasks" aria-labelledby="crm-360-tasks-title"><header><div><h2 id="crm-360-tasks-title">وظایف باز</h2><span>{count(overview.summary.openTaskCount)}</span></div><Link href="/platform/crm/tasks">صف وظایف</Link></header>{overview.sectionErrors.includes("tasks") ? <p className="crm-360-state crm-360-error" role="status">وظایف بارگذاری نشدند.</p> : overview.openTasks.length ? <ul>{overview.openTasks.map((task) => <li key={task.id}><a href="#crm-work"><strong>{task.title}</strong><span>{task.kind === "FOLLOW_UP" ? "پیگیری" : "وظیفه"} · {task.overdue ? "عقب‌افتاده" : dateTime(task.dueAt)}</span></a><small>{task.assigneeLabel ?? "بدون مسئول"}</small></li>)}</ul> : <p className="crm-360-state">وظیفه بازی وجود ندارد.</p>}</section>
      <section className="crm-360-list" id="crm-360-recent" aria-labelledby="crm-360-activity-title"><header><div><h2 id="crm-360-activity-title">فعالیت‌های اخیر</h2></div><a href="#crm-work">همه فعالیت‌ها</a></header>{overview.sectionErrors.includes("activities") ? <p className="crm-360-state crm-360-error" role="status">فعالیت‌ها بارگذاری نشدند.</p> : overview.recentActivities.length ? <ul>{overview.recentActivities.map((activity) => <li key={activity.id}><a href="#crm-work"><strong>{activityNames[activity.activityType] ?? "تعامل"} · {activity.subject}</strong><span>{activity.outcome ? outcomeNames[activity.outcome] ?? activity.outcome : activity.contactName ?? ""}</span></a><small>{dateTime(activity.occurredAt)}</small></li>)}</ul> : <p className="crm-360-state">هنوز فعالیتی ثبت نشده است.</p>}</section>
      <section className="crm-360-list" id="crm-360-notes" aria-labelledby="crm-360-notes-title"><header><div><h2 id="crm-360-notes-title">یادداشت‌های اخیر</h2></div><a href="#crm-work">همه یادداشت‌ها</a></header>{overview.sectionErrors.includes("notes") ? <p className="crm-360-state crm-360-error" role="status">یادداشت‌ها بارگذاری نشدند.</p> : overview.recentNotes.length ? <ul>{overview.recentNotes.map((note) => <li key={note.id}><a href="#crm-work"><strong>{note.body}</strong><span>{note.authorLabel ?? "نویسنده نامشخص"}</span></a><small>{dateTime(note.createdAt)}</small></li>)}</ul> : <p className="crm-360-state">یادداشتی ثبت نشده است.</p>}</section>
    </div>}

    {canViewCustomerContext && <section className="crm-360-timeline" id="crm-360-timeline" aria-labelledby="crm-360-timeline-title">
      <header><div><p>رویدادهای ثبت‌شده از منابع CRM و حساب UCafe</p><h2 id="crm-360-timeline-title">تاریخچه سازمان</h2></div><div className="crm-360-filters">
        <label>نوع رویداد<select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">همه</option>{Object.entries(categoryNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>از تاریخ<input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} /></label>
        <label>تا تاریخ<input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} /></label>
      </div></header>
      {timelineLoading ? <p className="crm-360-state" role="status">در حال دریافت Timeline…</p> : timelineError ? <p className="crm-360-state crm-360-error" role="alert">Timeline بارگذاری نشد. <button type="button" onClick={() => void loadTimeline()}>تلاش دوباره</button></p> : timeline.items.length ? <>
        <ol className="crm-timeline-list">{timeline.items.map((item) => <TimelineEntry key={item.id} item={item} canViewTenant={canViewTenant} />)}</ol>
        <nav className="crm-360-pagination" aria-label="صفحه‌بندی Timeline"><span>نمایش {fa.format(timeline.items.length)} از {fa.format(timeline.total)}</span><button type="button" disabled={page <= 1 || timelineLoading} onClick={() => setPage((current) => current - 1)}>قبلی</button><span>صفحه {fa.format(page)}</span><button type="button" disabled={page * timeline.pageSize >= timeline.total || timelineLoading} onClick={() => setPage((current) => current + 1)}>بعدی</button></nav>
      </> : <p className="crm-360-state">هنوز سابقه‌ای برای این کسب‌وکار ثبت نشده است.</p>}
    </section>}
  </div>;
}

function TimelineEntry({ item, canViewTenant }: { item: TimelineItem; canViewTenant: boolean }) {
  const metadata = item.metadata ?? {};
  const value = (key: string) => typeof metadata[key] === "string" ? String(metadata[key]) : "";
  const stage = (key: string) => (stageNames[value(key)] ?? value(key)) || "—";
  const title = (() => {
    switch (item.type) {
      case "LEAD_CREATED": return `سرنخ ثبت شد · ${item.title}`;
      case "LEAD_STATUS_CHANGED": return `وضعیت سرنخ از ${statusNames[value("previousStatus")] ?? value("previousStatus")} به ${statusNames[value("nextStatus")] ?? value("nextStatus")} تغییر کرد`;
      case "LEAD_QUALIFIED": return `سرنخ واجد شرایط شد · ${item.title}`;
      case "LEAD_UNQUALIFIED": return `سرنخ نامرتبط شد · ${item.title}`;
      case "LEAD_CONVERTED": return `سرنخ به سازمان تبدیل شد · ${item.title}`;
      case "DEAL_CREATED": return `فرصت ثبت شد · ${item.title}`;
      case "DEAL_STAGE_CHANGED": return `مرحله فرصت از ${stage("fromStage")} به ${stage("toStage")} تغییر کرد · ${item.title}`;
      case "DEAL_WON": return `فرصت برنده شد · ${item.title}`;
      case "DEAL_LOST": return `فرصت از دست رفت · ${item.title}`;
      case "ACTIVITY_LOGGED": return `${activityNames[value("activityType")] ?? "فعالیت"} · ${item.title}`;
      case "TASK_CREATED": return `وظیفه ثبت شد · ${item.title}`;
      case "TASK_COMPLETED": return `وظیفه انجام شد · ${item.title}`;
      case "TASK_CANCELED": return `وظیفه لغو شد · ${item.title}`;
      case "TASK_REOPENED": return `وظیفه دوباره باز شد · ${item.title}`;
      case "NOTE_ADDED": return "یادداشت";
      case "TENANT_CREATED": return `کافه در UCafe ثبت شد · ${item.title}`;
      case "TENANT_LINKED": return "کافه به سازمان پیوند خورد";
      case "TENANT_UNLINKED": return "کافه از سازمان جدا شد";
      case "TRIAL_STARTED": return `دوره آزمایشی آغاز شد${value("endsAt") ? ` · پایان ${formatDate(value("endsAt"))}` : ""}`;
      case "SUBSCRIPTION_ACTIVATED": return `اشتراک فعال شد · ${item.title}`;
      case "SUBSCRIPTION_RENEWED": return `اشتراک تمدید شد · ${item.title}`;
      case "SUBSCRIPTION_REACTIVATED": return `اشتراک دوباره فعال شد · ${item.title}`;
      case "SUBSCRIPTION_PLAN_CHANGED": return `پلن اشتراک تغییر کرد · ${item.title}`;
      default: return item.title || "رویداد CRM";
    }
  })();
  const tenantId = value("tenantId");
  const href = item.leadId ? `/platform/crm/leads/${item.leadId}` : item.dealId ? `/platform/crm/deals/${item.dealId}` : item.contactId ? `/platform/crm/contacts/${item.contactId}` : canViewTenant && tenantId ? `/platform?view=tenants&tenantId=${tenantId}` : item.category === "CUSTOMER" ? "#crm-360-customer" : "#crm-work";
  const actor = item.actor.label ?? (item.type === "LEAD_CREATED" && value("source") === "LANDING_FORM" ? "فرم مشاوره عمومی" : item.actor.kind === "SYSTEM" ? "سیستم" : "ثبت‌کننده نامشخص");
  const dealOutcome = item.type === "DEAL_WON" || item.type === "DEAL_LOST";
  const expandable = Boolean(item.description && item.description.length > 240);
  return <li className={`crm-timeline-item crm-timeline-${item.category.toLowerCase()}`}>
    <span className="crm-timeline-marker" aria-hidden="true">{({ LEAD: "س", DEAL: "ف", ACTIVITY: "ع", TASK: "و", NOTE: "ی", CUSTOMER: "م" } as Record<string, string>)[item.category] ?? "CRM"}</span>
    <article><header><strong>{title}</strong><Link href={href}>مشاهده رکورد</Link></header>
      {dealOutcome && <span className="crm-timeline-detail">مرحله: {stage("stage")}{item.type === "DEAL_LOST" && value("lossReason") ? ` · دلیل: ${lossReasonNames[value("lossReason")] ?? value("lossReason")}` : ""}</span>}
      {item.type === "ACTIVITY_LOGGED" && typeof metadata.outcome === "string" && <span className="crm-timeline-detail">{outcomeNames[metadata.outcome] ?? metadata.outcome}{typeof metadata.contactName === "string" ? ` · ${metadata.contactName}` : ""}</span>}
      {item.description && (expandable ? <details><summary>نمایش توضیحات</summary><p>{item.description}</p></details> : <p className={item.type === "NOTE_ADDED" ? "crm-timeline-note" : ""}>{item.description}</p>)}
      <footer><time dateTime={item.occurredAt}>{dateTime(item.occurredAt)}</time><span>{actor}</span></footer>
    </article>
  </li>;
}
