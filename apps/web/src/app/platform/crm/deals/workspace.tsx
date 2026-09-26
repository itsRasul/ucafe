"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { PlatformApi as Api, usePlatformSession } from "../../use-platform-session";
import { CrmShell } from "../workspace";

type Page<T> = { items: T[]; total: number; page: number; pageSize: number; stageTotals?: { stage: Stage; count: number; estimatedAmountToman: string }[] };
type Stage = "DISCOVERY" | "DEMO_SCHEDULED" | "DEMO_COMPLETED" | "TRIAL_PROPOSED" | "TRIAL_ACTIVE" | "DECISION";
type Status = "OPEN" | "WON" | "LOST";
type StageHistory = { id: string; fromStage: Stage | null; toStage: Stage; reason: string | null; createdAt: string; actorLabel: string | null };
type Deal = {
  id: string; title: string; organizationId: string; organizationName: string; organizationCity: string | null;
  primaryContactId: string | null; primaryContact: { id: string; name: string; role: string | null } | null;
  originatingLeadId: string | null; originatingLeadName: string | null; ownerId: string | null; ownerLabel: string | null;
  expectedPlanId: string | null; expectedPlanName: string | null; estimatedAmountToman: string | null; expectedCloseDate: string | null;
  pipelineKey: string; stage: Stage; status: Status; lossReason: string | null; lossReasonDetail: string | null;
  closedAt: string | null; wonAt: string | null; lostAt: string | null; archivedAt: string | null; createdAt: string; updatedAt: string;
  stageHistory?: StageHistory[];
};
type Organization = { id: string; name: string; city: string | null };
type Contact = { id: string; name: string; role: string | null };
type Owner = { id: string; label: string };
type Plan = { id: string; key: string; name: string };
type ConvertedLead = { id: string; status: string; businessName: string; organizationId: string | null; organizationName: string | null; primaryContactId: string | null; primaryContact: Contact | null };
type Options = { organizations: Organization[]; owners: Owner[]; plans: Plan[] };
type Filters = { q: string; status: string; ownerId: string; organizationId: string; expectedPlanId: string; expectedCloseFrom: string; expectedCloseTo: string; archiveStatus: string; sort: string; direction: string };
type Props = { mode: "list" | "pipeline" | "create" | "detail"; dealId?: string; leadId?: string };

const stages: Stage[] = ["DISCOVERY", "DEMO_SCHEDULED", "DEMO_COMPLETED", "TRIAL_PROPOSED", "TRIAL_ACTIVE", "DECISION"];
const stageNames: Record<Stage, string> = { DISCOVERY: "کشف نیاز", DEMO_SCHEDULED: "دموی زمان‌بندی‌شده", DEMO_COMPLETED: "دموی انجام‌شده", TRIAL_PROPOSED: "پیشنهاد آزمایشی", TRIAL_ACTIVE: "دوره آزمایشی", DECISION: "تصمیم خرید" };
const statusNames: Record<Status, string> = { OPEN: "باز", WON: "موفق", LOST: "از دست‌رفته" };
const lossNames: Record<string, string> = { PRICE: "قیمت", TIMING: "زمان‌بندی", PRODUCT_FIT: "تناسب محصول", NO_RESPONSE: "بی‌پاسخ", COMPETITOR: "رقیب", OTHER: "سایر" };
const lossReasons = Object.keys(lossNames);
const fa = new Intl.NumberFormat("fa-IR");
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(`${value.slice(0, 10)}T12:00:00`)) : "—";
const formatToman = (value?: string | null) => {
  if (value === null || value === undefined || value === "") return "—";
  try { return `${fa.format(BigInt(value))} تومان`; } catch { return "—"; }
};
const encode = (values: Record<string, string>) => new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""))).toString();
const stageNeedsReason = (from: Stage, to: Stage) => stages.indexOf(to) <= stages.indexOf(from) || stages.indexOf(to) > stages.indexOf(from) + 1;

export function CrmDealsWorkspace({ mode, dealId, leadId }: Props) {
  const { state, access, api } = usePlatformSession();
  if (state === "loading") return <main className="platform-entry"><p>در حال بررسی دسترسی…</p></main>;
  if (state !== "ready" || !access.includes("crm.read")) return <main className="platform-entry"><section><h1>دسترسی CRM فعال نیست</h1><p>برای دیدن فرصت‌های فروش به دسترسی crm.read نیاز دارید.</p><Link className="crm-button" href="/platform">بازگشت به پنل پلتفرم</Link></section></main>;
  if ((mode === "create" || mode === "detail") && !access.includes("crm.manage") && mode === "create") return <main className="platform-entry"><section><h1>دسترسی مدیریت CRM فعال نیست</h1><p>برای ساخت فرصت فروش به دسترسی crm.manage نیاز دارید.</p><Link className="crm-button" href="/platform/crm/deals">بازگشت به فرصت‌ها</Link></section></main>;
  return <CrmShell canManage={access.includes("crm.manage")}>
    {mode === "list" && <DealDirectory api={api} canManage={access.includes("crm.manage")} />}
    {mode === "pipeline" && <PipelineBoard api={api} canManage={access.includes("crm.manage")} />}
    {mode === "create" && <DealCreate api={api} leadId={leadId} />}
    {mode === "detail" && dealId && <DealDetail api={api} canManage={access.includes("crm.manage")} dealId={dealId} />}
  </CrmShell>;
}

function useOptions(api: Api) {
  const [options, setOptions] = useState<Options>({ organizations: [], owners: [], plans: [] });
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const orgQuery = encode({ page: "1", pageSize: "100", archiveStatus: "ACTIVE", sort: "name", direction: "ASC" });
    void Promise.all([
      api<Page<Organization>>(`/platform/crm/organizations?${orgQuery}`),
      api<Owner[]>("/platform/crm/leads/assignees"),
      api<Plan[]>("/platform/crm/deal-plans"),
    ]).then(([orgs, owners, plans]) => { if (!cancelled) setOptions({ organizations: orgs.items, owners, plans }); })
      .catch((reason) => { if (!cancelled) setError((reason as Error).message); });
    return () => { cancelled = true; };
  }, [api]);
  return { options, error };
}

function useContacts(api: Api, organizationId: string) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!organizationId) { setContacts([]); return; }
    const query = encode({ page: "1", pageSize: "100", archiveStatus: "ACTIVE", sort: "name", direction: "ASC" });
    void api<Page<Contact>>(`/platform/crm/organizations/${organizationId}/contacts?${query}`).then((result) => { if (!cancelled) setContacts(result.items); }).catch(() => { if (!cancelled) setContacts([]); });
    return () => { cancelled = true; };
  }, [api, organizationId]);
  return contacts;
}

function DealDirectory({ api, canManage }: { api: Api; canManage: boolean }) {
  const [filters, setFilters] = useState<Filters>({ q: "", status: "", ownerId: "", organizationId: "", expectedPlanId: "", expectedCloseFrom: "", expectedCloseTo: "", archiveStatus: "ACTIVE", sort: "updatedAt", direction: "DESC" });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Deal>>({ items: [], total: 0, page: 1, pageSize: 25 });
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const { options, error: optionsError } = useOptions(api);
  const query = encode({ ...filters, page: String(page), pageSize: "25" });
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void api<Page<Deal>>(`/platform/crm/deals?${query}`).then((value) => { if (!cancelled) setResult(value); })
      .catch((reason) => { if (!cancelled) setError((reason as Error).message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, query]);
  const update = (key: keyof Filters, value: string) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  return <>
    <header className="crm-section-heading"><div><h1>فرص فروش</h1><p>فرصت‌های باز و نتیجه‌های ثبت‌شده در CRM پلتفرم.</p></div><div className="crm-deal-heading-actions"><Link className="crm-button crm-secondary-link" href="/platform/crm/pipeline">نمای کانبان</Link>{canManage && <Link className="crm-button" href="/platform/crm/deals/new">فرصت جدید</Link>}</div></header>
    <DealFilters filters={filters} options={options} mode="list" onChange={update} />
    {optionsError && <p className="message error" role="alert">{optionsError}</p>}{error && <p className="message error" role="alert">{error}</p>}
    {loading ? <p className="empty" role="status">در حال دریافت فرصت‌ها…</p> : result.items.length === 0 ? <p className="empty crm-empty">هنوز هیچ فرصت فروشی ثبت نشده است.</p> : <>
      <div className="crm-deal-table-wrap"><table className="crm-deal-table"><thead><tr><th>فرصت</th><th>سازمان</th><th>مرحله</th><th>مسئول</th><th>طرح پیشنهادی</th><th>برآورد</th><th>تاریخ احتمالی</th><th>وضعیت</th><th>آخرین تغییر</th></tr></thead><tbody>
        {result.items.map((deal) => <tr key={deal.id}><td><Link href={`/platform/crm/deals/${deal.id}`}>{deal.title}</Link></td><td><Link href={`/platform/crm/organizations/${deal.organizationId}`}>{deal.organizationName}</Link></td><td>{stageNames[deal.stage]}</td><td>{deal.ownerLabel || "بدون مسئول"}</td><td>{deal.expectedPlanName || "—"}</td><td>{formatToman(deal.estimatedAmountToman)}</td><td>{formatDate(deal.expectedCloseDate)}</td><td><span className={`crm-status crm-deal-status-${deal.status.toLowerCase()}`}>{statusNames[deal.status]}</span></td><td>{formatDate(deal.updatedAt)}</td></tr>)}
      </tbody></table></div>
      <Pagination page={page} total={result.total} pageSize={result.pageSize} onPage={setPage} />
    </>}
  </>;
}

function PipelineBoard({ api, canManage }: { api: Api; canManage: boolean }) {
  const [filters, setFilters] = useState<Filters>({ q: "", status: "", ownerId: "", organizationId: "", expectedPlanId: "", expectedCloseFrom: "", expectedCloseTo: "", archiveStatus: "ACTIVE", sort: "updatedAt", direction: "DESC" });
  const [page, setPage] = useState(1); const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<Page<Deal>>({ items: [], total: 0, page: 1, pageSize: 100 });
  const [loading, setLoading] = useState(true); const [pendingId, setPendingId] = useState(""); const [error, setError] = useState("");
  const { options, error: optionsError } = useOptions(api);
  const query = encode({ ...filters, status: "OPEN", page: String(page), pageSize: "100" });
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void api<Page<Deal>>(`/platform/crm/deals?${query}`).then((value) => { if (!cancelled) setResult(value); })
      .catch((reason) => { if (!cancelled) setError((reason as Error).message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, query, refresh]);
  const update = (key: keyof Filters, value: string) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  async function move(deal: Deal, stage: Stage, reason: string | null) {
    if (!canManage || pendingId) return;
    setPendingId(deal.id); setError("");
    try {
      await api<Deal>(`/platform/crm/deals/${deal.id}/stage`, { method: "POST", body: JSON.stringify({ expectedStage: deal.stage, stage, reason }) });
      setRefresh((value) => value + 1);
    } catch (reasonValue) { setError((reasonValue as Error).message); }
    finally { setPendingId(""); }
  }
  function drop(event: React.DragEvent<HTMLElement>, stage: Stage) {
    event.preventDefault();
    const deal = result.items.find((item) => item.id === event.dataTransfer.getData("text/plain"));
    if (!deal || deal.stage === stage) return;
    const reason = stageNeedsReason(deal.stage, stage) ? window.prompt("برای عبور از مرحله یا بازگشت، دلیل کوتاهی بنویسید:")?.trim() : null;
    if (stageNeedsReason(deal.stage, stage) && !reason) return;
    void move(deal, stage, reason || null);
  }
  return <>
    <header className="crm-section-heading"><div><h1>خط فروش</h1><p>مرحله فرصت را با کشیدن کارت یا کنترل «تغییر مرحله» عوض کنید.</p></div><div className="crm-deal-heading-actions"><Link className="crm-button crm-secondary-link" href="/platform/crm/deals">فهرست فرصت‌ها</Link>{canManage && <Link className="crm-button" href="/platform/crm/deals/new">فرصت جدید</Link>}</div></header>
    <DealFilters filters={filters} options={options} mode="pipeline" onChange={update} />
    {optionsError && <p className="message error" role="alert">{optionsError}</p>}{error && <p className="message error" role="alert">{error}</p>}
    {loading ? <p className="empty" role="status">در حال دریافت خط فروش…</p> : result.total === 0 ? <p className="empty crm-empty">هنوز هیچ فرصت فروشی در این مرحله وجود ندارد.</p> : <>
      <p className="crm-deal-page-summary" role="status">نمایش {fa.format((page - 1) * result.pageSize + 1)} تا {fa.format(Math.min(page * result.pageSize, result.total))} از {fa.format(result.total)} فرصت باز</p>
      <div className="crm-deal-board" aria-label="مراحل خط فروش">
        {stages.map((stage) => {
          const summary = result.stageTotals?.find((item) => item.stage === stage);
          return <section className="crm-deal-column" key={stage} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, stage)} aria-label={`${stageNames[stage]}، ${summary?.count ?? 0} فرصت`}>
            <header><h2>{stageNames[stage]}</h2><strong>{fa.format(summary?.count ?? 0)}</strong><small>{formatToman(summary?.estimatedAmountToman)}</small></header>
            {result.items.filter((deal) => deal.stage === stage).map((deal) => <article className={`crm-deal-card${pendingId === deal.id ? " is-pending" : ""}`} key={deal.id} draggable={canManage && !pendingId} onDragStart={(event) => event.dataTransfer.setData("text/plain", deal.id)}>
              <Link className="crm-deal-card-title" href={`/platform/crm/deals/${deal.id}`}>{deal.title}</Link>
              <Link className="crm-deal-card-org" href={`/platform/crm/organizations/${deal.organizationId}`}>{deal.organizationName}</Link>
              <div className="crm-deal-card-meta"><span>{deal.expectedPlanName || "بدون طرح"}</span><span>{formatToman(deal.estimatedAmountToman)}</span><span>{deal.ownerLabel || "بدون مسئول"}</span><span>موعد: {formatDate(deal.expectedCloseDate)}</span></div>
              {pendingId === deal.id && <small role="status">در حال انتقال…</small>}
              {canManage && <StageControl api={api} deal={deal} onDone={() => setRefresh((value) => value + 1)} onError={setError} />}
            </article>)}
            {(summary?.count ?? 0) === 0 && <p className="crm-deal-column-empty">هنوز فرصتی در این مرحله نیست.</p>}
          </section>;
        })}
      </div>
      <Pagination page={page} total={result.total} pageSize={result.pageSize} onPage={setPage} />
    </>}
  </>;
}

function DealFilters({ filters, options, mode, onChange }: { filters: Filters; options: Options; mode: "list" | "pipeline"; onChange: (key: keyof Filters, value: string) => void }) {
  return <section className="crm-deal-filters" aria-label="فیلتر فرصت‌ها">
    <label>جست‌وجو<input value={filters.q} onChange={(event) => onChange("q", event.target.value)} placeholder="عنوان، سازمان یا فرد رابط" /></label>
    {mode === "list" && <label>وضعیت<select value={filters.status} onChange={(event) => onChange("status", event.target.value)}><option value="">همه وضعیت‌ها</option>{Object.entries(statusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
    <label>مسئول<select value={filters.ownerId} onChange={(event) => onChange("ownerId", event.target.value)}><option value="">همه مسئول‌ها</option><option value="UNASSIGNED">بدون مسئول</option>{options.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.label}</option>)}</select></label>
    <label>سازمان<select value={filters.organizationId} onChange={(event) => onChange("organizationId", event.target.value)}><option value="">همه سازمان‌ها</option>{options.organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
    <label>طرح مورد انتظار<select value={filters.expectedPlanId} onChange={(event) => onChange("expectedPlanId", event.target.value)}><option value="">همه طرح‌ها</option>{options.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
    <label>از تاریخ احتمالی<input type="date" dir="ltr" value={filters.expectedCloseFrom} onChange={(event) => onChange("expectedCloseFrom", event.target.value)} /></label>
    <label>تا تاریخ احتمالی<input type="date" dir="ltr" value={filters.expectedCloseTo} onChange={(event) => onChange("expectedCloseTo", event.target.value)} /></label>
    {mode === "list" && <label>نمایش<select value={filters.archiveStatus} onChange={(event) => onChange("archiveStatus", event.target.value)}><option value="ACTIVE">فعال</option><option value="ARCHIVED">بایگانی‌شده</option><option value="ALL">همه</option></select></label>}
  </section>;
}

function DealCreate({ api, leadId }: { api: Api; leadId?: string }) {
  const router = useRouter(); const { options, error: optionsError } = useOptions(api);
  const [lead, setLead] = useState<ConvertedLead | null>(null);
  const [leadLoading, setLeadLoading] = useState(Boolean(leadId)); const [leadError, setLeadError] = useState("");
  const [values, setValues] = useState({ title: "", organizationId: "", primaryContactId: "", originatingLeadId: leadId ?? "", ownerId: "", expectedPlanId: "", stage: stages[0]!, estimatedAmountToman: "", expectedCloseDate: "" });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const contacts = useContacts(api, values.organizationId);
  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    void api<ConvertedLead>(`/platform/crm/leads/${leadId}`).then((value) => {
      if (cancelled) return;
      if (!(value.status === "CONVERTED" || value.status === "QUALIFIED") || !value.organizationId) { setLeadError("برای ساخت فرصت، سرنخ باید واجد شرایط یا تبدیل‌شده و به یک سازمان متصل باشد."); return; }
      setLead(value);
      setValues((current) => ({ ...current, title: `${value.businessName} — فرصت فروش`, organizationId: value.organizationId!, primaryContactId: value.primaryContactId ?? "" }));
    }).catch((reason) => { if (!cancelled) setLeadError((reason as Error).message); }).finally(() => { if (!cancelled) setLeadLoading(false); });
    return () => { cancelled = true; };
  }, [api, leadId]);
  const organizationOptions = lead?.organizationId && !options.organizations.some((item) => item.id === lead.organizationId) ? [...options.organizations, { id: lead.organizationId, name: lead.organizationName ?? "سازمان سرنخ", city: null }] : options.organizations;
  function field(key: keyof typeof values) { return (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((current) => ({ ...current, [key]: event.target.value })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const deal = await api<Deal>("/platform/crm/deals", { method: "POST", body: JSON.stringify({ title: values.title, organizationId: values.organizationId, primaryContactId: values.primaryContactId || null, originatingLeadId: values.originatingLeadId || null, ownerId: values.ownerId || null, expectedPlanId: values.expectedPlanId || null, stage: values.stage, estimatedAmountToman: values.estimatedAmountToman || null, expectedCloseDate: values.expectedCloseDate || null }) });
      router.push(`/platform/crm/deals/${deal.id}`);
    } catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  }
  if (leadLoading) return <p className="empty" role="status">در حال دریافت سرنخ…</p>;
  if (leadError) return <><DealBreadcrumb title="فرصت جدید" /><p className="message error" role="alert">{leadError}</p><Link href={leadId ? `/platform/crm/leads/${leadId}` : "/platform/crm/deals"}>بازگشت</Link></>;
  return <>
    <DealBreadcrumb title="فرصت جدید" />
    <header className="crm-section-heading"><div><h1>ثبت فرصت فروش</h1><p>فرصت فروش از سرنخ و اشتراک UCafe مستقل است.</p></div></header>
    {(error || optionsError) && <p className="message error" role="alert">{error || optionsError}</p>}
    <DealForm values={values} field={field} organizationOptions={organizationOptions} contacts={contacts} options={options} lockedOrganization={Boolean(lead)} saving={saving} error="" onSubmit={submit} onCancel={() => router.back()} submitLabel="ثبت فرصت" />
  </>;
}

type DealValues = { title: string; organizationId: string; primaryContactId: string; originatingLeadId: string; ownerId: string; expectedPlanId: string; stage: Stage; estimatedAmountToman: string; expectedCloseDate: string };
function DealForm({ values, field, organizationOptions, contacts, options, lockedOrganization, saving, error, onSubmit, onCancel, submitLabel }: { values: DealValues; field: (key: keyof DealValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void; organizationOptions: Organization[]; contacts: Contact[]; options: Options; lockedOrganization: boolean; saving: boolean; error: string; onSubmit: (event: FormEvent, values: DealValues) => void; onCancel: () => void; submitLabel: string }) {
  return <form className="form crm-form crm-deal-form" onSubmit={(event) => onSubmit(event, values)}>
    {error && <p className="message error" role="alert">{error}</p>}
    <label>عنوان فرصت<input required maxLength={200} value={values.title} onChange={field("title")} /></label>
    <label>سازمان<select required disabled={lockedOrganization} value={values.organizationId} onChange={field("organizationId")}><option value="">انتخاب سازمان</option>{organizationOptions.map((item) => <option key={item.id} value={item.id}>{item.name}{item.city ? ` · ${item.city}` : ""}</option>)}</select></label>
    <label>فرد رابط (اختیاری)<select value={values.primaryContactId} onChange={field("primaryContactId")}><option value="">بدون فرد رابط</option>{contacts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.role ? ` · ${item.role}` : ""}</option>)}</select></label>
    <label>مسئول<select value={values.ownerId} onChange={field("ownerId")}><option value="">بدون مسئول</option>{options.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.label}</option>)}</select></label>
    <label>طرح مورد انتظار<select value={values.expectedPlanId} onChange={field("expectedPlanId")}><option value="">انتخاب نشده</option>{options.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select><small>این فقط طرح پیشنهادی در فرایند فروش است و اشتراک مشتری را تغییر نمی‌دهد.</small></label>
    <label>برآورد ارزش (تومان)<input inputMode="numeric" pattern="[0-9]*" maxLength={19} value={values.estimatedAmountToman} onChange={field("estimatedAmountToman")} placeholder="اختیاری" /></label>
    <label>تاریخ احتمالی بستن<input type="date" dir="ltr" value={values.expectedCloseDate} onChange={field("expectedCloseDate")} /></label>
    <label>مرحله آغازین<select value={values.stage} onChange={field("stage")}>{stages.map((stage) => <option key={stage} value={stage}>{stageNames[stage]}</option>)}</select></label>
    <div className="crm-form-actions"><button disabled={saving || !values.organizationId}>{saving ? "در حال ذخیره…" : submitLabel}</button><button type="button" className="crm-secondary" onClick={onCancel}>انصراف</button></div>
  </form>;
}

function DealDetail({ api, canManage, dealId }: { api: Api; canManage: boolean; dealId: string }) {
  const [deal, setDeal] = useState<Deal | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false); const [editValues, setEditValues] = useState<DealValues | null>(null); const [action, setAction] = useState<"win" | "lose" | "archive" | null>(null); const [busy, setBusy] = useState(false);
  const { options } = useOptions(api);
  const contacts = useContacts(api, deal?.organizationId ?? "");
  async function load() {
    setLoading(true); setError("");
    try { setDeal(await api<Deal>(`/platform/crm/deals/${dealId}`)); } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [api, dealId]);
  async function update(body: Record<string, unknown>) { return api<Deal>(`/platform/crm/deals/${dealId}`, { method: "PATCH", body: JSON.stringify(body) }); }
  async function runAction(kind: "win" | "lose" | "archive" | "restore", body?: unknown) {
    setBusy(true); setError("");
    try {
      const updated = await api<Deal>(`/platform/crm/deals/${dealId}/${kind}`, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      setDeal(updated); setAction(null); setNotice(kind === "win" ? "فرصت با نتیجه موفق بسته شد." : kind === "lose" ? "دلیل از دست‌رفتن ثبت شد." : kind === "archive" ? "فرصت بایگانی شد؛ سوابق حفظ شده‌اند." : "فرصت بازیابی شد.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  if (loading && !deal) return <p className="empty" role="status">در حال دریافت فرصت…</p>;
  if (!deal) return <><DealBreadcrumb title="فرصت پیدا نشد" /><p className="message error" role="alert">{error}</p><Link href="/platform/crm/deals">بازگشت به فرصت‌ها</Link></>;
  const editable = canManage && !deal.archivedAt && deal.status === "OPEN";
  const initial: DealValues = { title: deal.title, organizationId: deal.organizationId, primaryContactId: deal.primaryContactId ?? "", originatingLeadId: deal.originatingLeadId ?? "", ownerId: deal.ownerId ?? "", expectedPlanId: deal.expectedPlanId ?? "", stage: deal.stage, estimatedAmountToman: deal.estimatedAmountToman ?? "", expectedCloseDate: deal.expectedCloseDate?.slice(0, 10) ?? "" };
  const organizationOptions = !options.organizations.some((item) => item.id === deal.organizationId) ? [...options.organizations, { id: deal.organizationId, name: deal.organizationName, city: deal.organizationCity }] : options.organizations;
  const contactOptions = deal.primaryContact && !contacts.some((item) => item.id === deal.primaryContactId) ? [...contacts, deal.primaryContact] : contacts;
  const editOptions: Options = {
    ...options,
    owners: deal.ownerId && !options.owners.some((item) => item.id === deal.ownerId) && deal.ownerLabel ? [...options.owners, { id: deal.ownerId, label: deal.ownerLabel }] : options.owners,
    plans: deal.expectedPlanId && !options.plans.some((item) => item.id === deal.expectedPlanId) && deal.expectedPlanName ? [...options.plans, { id: deal.expectedPlanId, key: "", name: deal.expectedPlanName }] : options.plans,
  };
  async function saveEdit(event: FormEvent, values: DealValues) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const updated = await update({ title: values.title, primaryContactId: values.primaryContactId || null, ownerId: values.ownerId || null, expectedPlanId: values.expectedPlanId || null, estimatedAmountToman: values.estimatedAmountToman || null, expectedCloseDate: values.expectedCloseDate || null });
      setDeal(updated); setEditing(false); setEditValues(null); setNotice("اطلاعات فرصت ذخیره شد.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <DealBreadcrumb title={deal.title} />
    {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success" role="status">{notice}</p>}
    {deal.archivedAt && <p className="message warning">این فرصت بایگانی شده است؛ نتیجه و تاریخچه حفظ شده‌اند.</p>}
    {editing ? <section className="crm-lead-panel"><header className="crm-section-heading"><h2>ویرایش فرصت</h2></header><DealForm values={editValues ?? initial} field={(key) => (event) => { const value = event.target.value; setEditValues((current) => ({ ...(current ?? initial), [key]: value })); }} organizationOptions={organizationOptions} contacts={contactOptions} options={editOptions} lockedOrganization onSubmit={(event, values) => void saveEdit(event, values)} saving={busy} error={error} onCancel={() => { setEditing(false); setEditValues(null); }} submitLabel="ذخیره تغییرات" /></section> : <section className="detail crm-lead-detail">
      <header className="crm-lead-detail-heading"><div><h1>{deal.title}</h1><p><Link href={`/platform/crm/organizations/${deal.organizationId}`}>{deal.organizationName}</Link>{deal.organizationCity ? ` · ${deal.organizationCity}` : ""}</p></div><span className={`crm-status crm-deal-status-${deal.status.toLowerCase()}`}>{statusNames[deal.status]}</span></header>
      {canManage && <div className="crm-actions crm-deal-actions">
        {editable && <><button type="button" onClick={() => { setEditValues(initial); setEditing(true); }}>ویرایش</button><button type="button" onClick={() => setAction(action === "win" ? null : "win")}>ثبت موفقیت</button><button type="button" className="crm-secondary" onClick={() => setAction(action === "lose" ? null : "lose")}>ثبت ازدست‌رفتن</button></>}
        {!deal.archivedAt && <button type="button" className="crm-danger" onClick={() => setAction(action === "archive" ? null : "archive")}>بایگانی</button>}
        {deal.archivedAt && <button type="button" onClick={() => void runAction("restore")}>بازیابی</button>}
      </div>}
      {action === "win" && <div className="crm-deal-action-panel"><p>ثبت موفقیت فقط نتیجه فروش را ثبت می‌کند و اشتراک یا پرداختی ایجاد نمی‌کند.</p><button type="button" disabled={busy} onClick={() => void runAction("win")}>{busy ? "در حال ثبت…" : "تأیید نتیجه موفق"}</button><button type="button" className="crm-secondary" onClick={() => setAction(null)}>انصراف</button></div>}
      {action === "lose" && <LossForm busy={busy} onCancel={() => setAction(null)} onSubmit={(body) => void runAction("lose", body)} />}
      {action === "archive" && <div className="crm-deal-action-panel"><p>فرصت از فهرست فعال پنهان می‌شود و نتیجه و تاریخچه آن باقی می‌ماند.</p><button type="button" disabled={busy} onClick={() => void runAction("archive")}>تأیید بایگانی</button><button type="button" className="crm-secondary" onClick={() => setAction(null)}>انصراف</button></div>}
      <dl className="crm-facts"><div><dt>وضعیت</dt><dd>{statusNames[deal.status]}</dd></div><div><dt>مرحله</dt><dd>{stageNames[deal.stage]}</dd></div><div><dt>سازمان</dt><dd><Link href={`/platform/crm/organizations/${deal.organizationId}`}>{deal.organizationName}</Link></dd></div><div><dt>فرد رابط</dt><dd>{deal.primaryContact ? `${deal.primaryContact.name}${deal.primaryContact.role ? ` · ${deal.primaryContact.role}` : ""}` : "ثبت نشده"}</dd></div><div><dt>سرنخ مبدأ</dt><dd>{deal.originatingLeadId ? <Link href={`/platform/crm/leads/${deal.originatingLeadId}`}>{deal.originatingLeadName}</Link> : "ثبت نشده"}</dd></div><div><dt>مسئول</dt><dd>{deal.ownerLabel || "بدون مسئول"}</dd></div><div><dt>طرح مورد انتظار</dt><dd>{deal.expectedPlanName || "ثبت نشده"}</dd></div><div><dt>برآورد ارزش</dt><dd>{formatToman(deal.estimatedAmountToman)}</dd></div><div><dt>تاریخ احتمالی بستن</dt><dd>{formatDate(deal.expectedCloseDate)}</dd></div><div><dt>تاریخ ثبت</dt><dd>{formatDate(deal.createdAt)}</dd></div><div><dt>تاریخ بسته‌شدن</dt><dd>{formatDate(deal.closedAt)}</dd></div>{deal.lossReason && <div><dt>دلیل ازدست‌رفتن</dt><dd>{lossNames[deal.lossReason] ?? deal.lossReason}{deal.lossReasonDetail ? ` · ${deal.lossReasonDetail}` : ""}</dd></div>}</dl>
      {editable && <StageControl api={api} deal={deal} onDone={(value) => { setDeal(value); setNotice("مرحله فرصت تغییر کرد."); }} onError={setError} />}
    </section>}
    <section className="crm-lead-panel" aria-labelledby="crm-deal-history-title"><header className="crm-section-heading"><div><h2 id="crm-deal-history-title">تاریخچه مراحل</h2><p>هر ورود و جابه‌جایی مرحله با زمان و مسئول نگهداری می‌شود.</p></div></header>{deal.stageHistory?.length ? <ol className="crm-deal-history">{[...deal.stageHistory].reverse().map((item) => <li key={item.id}><span className="crm-status">{stageNames[item.toStage]}</span><small>{formatDate(item.createdAt)} · {item.actorLabel || "ثبت سامانه"}{item.fromStage ? ` · از ${stageNames[item.fromStage]}` : " · مرحله آغازین"}</small>{item.reason && <p>{item.reason}</p>}</li>)}</ol> : <p className="empty crm-empty">تاریخچه مرحله‌ای ثبت نشده است.</p>}</section>
  </>;
}

function StageControl({ api, deal, onDone, onError }: { api: Api; deal: Deal; onDone: (deal: Deal) => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false); const [stage, setStage] = useState<Stage>(deal.stage); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { setStage(deal.stage); setReason(""); }, [deal.stage, deal.updatedAt]);
  const required = stage !== deal.stage && stageNeedsReason(deal.stage, stage);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (stage === deal.stage) return;
    setBusy(true); onError("");
    try {
      onDone(await api<Deal>(`/platform/crm/deals/${deal.id}/stage`, { method: "POST", body: JSON.stringify({ expectedStage: deal.stage, stage, reason: reason || null }) }));
      setOpen(false);
    } catch (error) { onError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="crm-stage-control">
    {!open ? <button type="button" className="crm-secondary" onClick={() => setOpen(true)}>تغییر مرحله</button> : <form className="crm-state-form" onSubmit={(event) => void submit(event)}>
      <label>مرحله جدید<select value={stage} onChange={(event) => setStage(event.target.value as Stage)}>{stages.map((item) => <option key={item} value={item}>{stageNames[item]}</option>)}</select></label>
      <label>دلیل {required ? "(برای برگشت یا عبور از مرحله لازم است)" : "(اختیاری)"}<input maxLength={500} required={required} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <button disabled={busy || stage === deal.stage}>{busy ? "در حال ثبت…" : "ثبت مرحله"}</button><button type="button" className="crm-secondary" onClick={() => setOpen(false)}>بستن</button>
    </form>}
  </div>;
}

function LossForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (body: { reason: string; detail?: string }) => void }) {
  const [reason, setReason] = useState("PRICE"); const [detail, setDetail] = useState("");
  return <form className="crm-state-form crm-deal-action-panel" onSubmit={(event) => { event.preventDefault(); onSubmit({ reason, ...(reason === "OTHER" && detail ? { detail } : {}) }); }}>
    <label>دلیل ازدست‌رفتن<select value={reason} onChange={(event) => setReason(event.target.value)}>{lossReasons.map((item) => <option key={item} value={item}>{lossNames[item]}</option>)}</select></label>
    {reason === "OTHER" && <label>جزئیات اختیاری<input maxLength={500} value={detail} onChange={(event) => setDetail(event.target.value)} /></label>}
    <button disabled={busy}>{busy ? "در حال ثبت…" : "تأیید نتیجه ازدست‌رفته"}</button><button type="button" className="crm-secondary" onClick={onCancel}>انصراف</button>
  </form>;
}

function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="crm-pagination" aria-label="صفحه‌بندی فرصت‌ها"><button type="button" className="crm-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>قبلی</button><span>صفحه {fa.format(page)} از {fa.format(pages)}</span><button type="button" className="crm-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>بعدی</button></nav>;
}

function DealBreadcrumb({ title }: { title: string }) { return <nav className="platform-nav-label crm-breadcrumb" aria-label="مسیر صفحه"><Link href="/platform/crm/deals">فرصت‌ها</Link><span aria-hidden="true"> / </span><span>{title}</span></nav>; }
