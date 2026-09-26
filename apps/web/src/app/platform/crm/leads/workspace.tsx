"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { PlatformApi as Api, usePlatformSession } from "../../use-platform-session";
import { CrmWorkSections } from "../work";

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type Lead = {
  id: string; businessName: string; contactName: string | null; phone?: string | null; email?: string | null;
  city: string | null; website: string | null; instagram: string | null; description: string | null;
  source: string; status: string; priority: string; ownerId: string | null; ownerLabel: string | null;
  organizationId: string | null; organizationName: string | null; primaryContactId: string | null;
  primaryContact: { id: string; name: string; role: string | null } | null; sourceRequestId: string | null;
  sourceRequest: { businessStage: string; requestedServices: string[]; createdAt: string } | null;
  qualificationNotes: string | null; unqualifiedReason: string | null; unqualifiedReasonDetail: string | null;
  qualifiedAt: string | null; convertedAt: string | null; archivedAt: string | null; createdAt: string; updatedAt: string;
  statusHistory?: { id: string; previousStatus: string | null; nextStatus: string; reason: string | null; actorLabel: string | null; createdAt: string }[];
};
type UserOption = { id: string; label: string };
type Candidate = { type: "ORGANIZATION" | "CONTACT" | "LEAD"; id: string; businessName?: string; contactName?: string; city?: string | null; organizationId?: string | null; organizationName?: string; contactId?: string | null; status?: string; archivedAt?: string | null; matchingFields: string[] };
type Props = { mode: "list" | "create" | "detail"; leadId?: string };
type Values = { businessName: string; contactName: string; phone: string; email: string; city: string; website: string; instagram: string; description: string; source: string; priority: string; ownerId: string; organizationId: string; primaryContactId: string };
type ApiError = Error & { data?: { candidates?: Candidate[] } };

const sources: Record<string, string> = { OUTBOUND_CALL: "تماس خروجی", LANDING_FORM: "فرم سایت", SEO: "جست‌وجوی وب", INSTAGRAM: "اینستاگرام", REFERRAL: "معرفی", SMS: "پیامک", PARTNER: "همکار تجاری", MANUAL: "ثبت دستی", OTHER: "سایر" };
const statuses: Record<string, string> = { NEW: "جدید", ATTEMPTING_CONTACT: "در حال پیگیری", CONTACTED: "تماس برقرار شد", QUALIFIED: "واجد شرایط", NURTURING: "پیگیری در آینده", UNQUALIFIED: "نامتناسب", CONVERTED: "تبدیل‌شده" };
const priorities: Record<string, string> = { LOW: "کم", NORMAL: "عادی", HIGH: "زیاد" };
const reasons: Record<string, string> = { NOT_INTERESTED: "علاقه‌مند نیست", NOT_RELEVANT: "تناسب ندارد", NO_BUDGET: "بودجه ندارد", NO_RESPONSE: "پاسخی دریافت نشد", DUPLICATE: "تکراری", INVALID_CONTACT: "اطلاعات تماس نامعتبر", ALREADY_USING_COMPETITOR: "از رقیب استفاده می‌کند", TOO_EARLY: "زمان مناسبی نیست", OTHER: "سایر" };
const stages: Record<string, string> = { LAUNCHING: "در حال راه‌اندازی", OPERATING: "در حال فعالیت", MULTI_BRANCH: "چند شعبه" };
const services: Record<string, string> = { WEBSITE: "وب‌سایت", ONLINE_MENU: "منوی آنلاین", RESERVATIONS: "رزرو", CONTENT_MANAGEMENT: "مدیریت محتوا", CONSULTATION: "مشاوره" };
const fa = new Intl.NumberFormat("fa-IR");
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(value)) : "—";
const encode = (values: Record<string, string>) => new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""))).toString();
const emptyValues = (): Values => ({ businessName: "", contactName: "", phone: "", email: "", city: "", website: "", instagram: "", description: "", source: "MANUAL", priority: "NORMAL", ownerId: "", organizationId: "", primaryContactId: "" });
const matchNames: Record<string, string> = { business_name_city: "نام کسب‌وکار و شهر", phone: "شماره تماس", email: "ایمیل", website: "وب‌سایت", instagram: "اینستاگرام" };

export function CrmLeadsWorkspace({ mode, leadId }: Props) {
  const { state, access, api } = usePlatformSession();
  if (state === "loading") return <main className="platform-entry"><p>در حال بررسی دسترسی…</p></main>;
  if (state !== "ready") return <main className="platform-entry"><section><h1>{state === "denied" ? "دسترسی CRM فعال نیست" : "نشست پلتفرم در دسترس نیست"}</h1><p>برای کار با سرنخ‌ها به دسترسی پلتفرم و crm.read نیاز دارید.</p><Link className="crm-button" href="/platform">بازگشت به پنل پلتفرم</Link></section></main>;
  if (!access.includes("crm.read")) return <main className="platform-entry"><section><h1>دسترسی CRM فعال نیست</h1><p>برای دیدن سرنخ‌ها به دسترسی crm.read نیاز دارید.</p><Link className="crm-button" href="/platform">بازگشت به پنل پلتفرم</Link></section></main>;
  const canManage = access.includes("crm.manage");
  if (mode !== "list" && !canManage) return <main className="platform-entry"><section><h1>دسترسی مدیریت CRM فعال نیست</h1><p>برای تغییر سرنخ‌ها به دسترسی crm.manage نیاز دارید.</p><Link className="crm-button" href="/platform/crm/leads">بازگشت به سرنخ‌ها</Link></section></main>;
  return <LeadShell canManage={canManage}>
    {mode === "list" && <LeadDirectory api={api} canManage={canManage} />}
    {mode === "create" && <LeadCreate api={api} />}
    {mode === "detail" && leadId && <LeadDetail api={api} canManage={canManage} leadId={leadId} />}
  </LeadShell>;
}

function LeadShell({ children, canManage }: { children: React.ReactNode; canManage: boolean }) {
  return <main className="platform-app crm-app"><div className="platform-frame">
    <aside className="platform-sidebar"><div><div className="platform-brand"><span><strong>CRM یو کافه</strong><small>مدیریت ارتباط‌های تجاری</small></span></div><p className="platform-nav-label">فضای کاری CRM</p><nav aria-label="ناوبری CRM"><Link className="platform-crm-link" href="/platform/crm">سازمان‌ها</Link><Link className="platform-crm-link" href="/platform/crm/leads">سرنخ‌ها</Link><Link className="platform-crm-link" href="/platform/crm/tasks">وظایف</Link>{canManage && <Link className="platform-crm-link" href="/platform/crm/leads/new">افزودن سرنخ</Link>}</nav></div><Link className="crm-back" href="/platform">بازگشت به پلتفرم</Link></aside>
    <section className="platform-shell"><header className="platform-topbar"><strong>مدیریت ارتباط‌های تجاری</strong><Link href="/platform">پنل پلتفرم</Link></header><div className="crm-content">{children}</div><nav className="platform-bottom-nav" aria-label="ناوبری موبایل CRM"><Link className="platform-crm-link" href="/platform/crm">سازمان‌ها</Link><Link className="platform-crm-link" href="/platform/crm/leads">سرنخ‌ها</Link><Link className="platform-crm-link" href="/platform/crm/tasks">وظایف</Link>{canManage && <Link className="platform-crm-link" href="/platform/crm/leads/new">افزودن سرنخ</Link>}</nav></section>
  </div></main>;
}

function LeadDirectory({ api, canManage }: { api: Api; canManage: boolean }) {
  const [result, setResult] = useState<Page<Lead>>({ items: [], total: 0, page: 1, pageSize: 25 });
  const [assignees, setAssignees] = useState<UserOption[]>([]);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [archiveStatus, setArchiveStatus] = useState("ACTIVE");
  const [sort, setSort] = useState("createdAt");
  const [direction, setDirection] = useState("DESC");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { void api<UserOption[]>("/platform/crm/leads/assignees").then(setAssignees).catch(() => setAssignees([])); }, [api]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    const query = encode({ q, status, source, priority, ownerId, archiveStatus, sort, direction, page: String(page), pageSize: "25" });
    void api<Page<Lead>>(`/platform/crm/leads?${query}`).then((value) => { if (!cancelled) setResult(value); }).catch((reason) => { if (!cancelled) setError((reason as Error).message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, q, status, source, priority, ownerId, archiveStatus, sort, direction, page]);
  const reset = (setter: (value: string) => void) => (value: string) => { setter(value); setPage(1); };
  return <>
    <header className="crm-heading"><div><p className="platform-nav-label">پلتفرم / CRM</p><h1>سرنخ‌ها</h1><p>پیگیری کسب‌وکارهای علاقه‌مند به UCafe.</p></div>{canManage && <Link className="crm-button" href="/platform/crm/leads/new">افزودن سرنخ</Link>}</header>
    <form className="crm-filters crm-lead-filters" onSubmit={(event) => { event.preventDefault(); setPage(1); }}>
      <label>جست‌وجو<input value={q} onChange={(event) => reset(setQ)(event.target.value)} placeholder="کسب‌وکار، فرد، ایمیل یا شماره" /></label>
      <label>وضعیت<select value={status} onChange={(event) => reset(setStatus)(event.target.value)}><option value="">همه وضعیت‌ها</option>{Object.entries(statuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>منبع<select value={source} onChange={(event) => reset(setSource)(event.target.value)}><option value="">همه منابع</option>{Object.entries(sources).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>اولویت<select value={priority} onChange={(event) => reset(setPriority)(event.target.value)}><option value="">همه اولویت‌ها</option>{Object.entries(priorities).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>مسئول<select value={ownerId} onChange={(event) => reset(setOwnerId)(event.target.value)}><option value="">همه مسئولان</option><option value="UNASSIGNED">بدون مسئول</option>{assignees.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <label>نمایش<select value={archiveStatus} onChange={(event) => reset(setArchiveStatus)(event.target.value)}><option value="ACTIVE">فعال</option><option value="ARCHIVED">بایگانی‌شده</option><option value="ALL">همه</option></select></label>
      <label>مرتب‌سازی<select value={`${sort}:${direction}`} onChange={(event) => { const [nextSort, nextDirection] = event.target.value.split(":"); setSort(nextSort!); setDirection(nextDirection!); setPage(1); }}><option value="createdAt:DESC">جدیدترین</option><option value="createdAt:ASC">قدیمی‌ترین</option><option value="updatedAt:DESC">آخرین تغییر</option><option value="priority:ASC">اولویت زیاد به کم</option><option value="status:ASC">وضعیت</option></select></label>
    </form>
    {error && <p className="message error" role="alert">{error}</p>}
    {loading ? <p className="empty" role="status">در حال دریافت سرنخ‌ها…</p> : result.items.length === 0 ? <div className="empty"><strong>{archiveStatus === "ACTIVE" ? "هنوز سرنخی ثبت نشده است." : "سرنخی با این شرایط پیدا نشد."}</strong><p>{archiveStatus === "ACTIVE" ? "فرم مشاوره سایت به‌صورت خودکار یک سرنخ ایجاد می‌کند." : "فیلترها را تغییر دهید یا سرنخ دیگری جست‌وجو کنید."}</p>{canManage && archiveStatus === "ACTIVE" && <Link className="crm-button" href="/platform/crm/leads/new">افزودن اولین سرنخ</Link>}</div> : <div className="crm-lead-list" aria-label="فهرست سرنخ‌ها">{result.items.map((lead) => <Link className="crm-lead-row" key={lead.id} href={`/platform/crm/leads/${lead.id}`}>
      <span className="crm-lead-main"><strong>{lead.businessName}</strong><small>{lead.contactName || "فرد رابط ثبت نشده"}{lead.city ? ` · ${lead.city}` : ""}</small>{lead.organizationName && <small>سازمان: {lead.organizationName}</small>}</span>
      <span className="crm-lead-badges"><span className={`crm-status crm-status-${lead.status.toLowerCase()}`}>{statuses[lead.status] ?? lead.status}</span><small>{sources[lead.source] ?? lead.source} · اولویت {priorities[lead.priority] ?? lead.priority}</small></span>
      <span className="crm-lead-meta"><small>{lead.ownerLabel || "بدون مسئول"}</small><small>{formatDate(lead.createdAt)}</small></span>
    </Link>)}</div>}
    <div className="crm-pagination"><span>مجموع: {fa.format(result.total)}</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>قبلی</button><span>صفحه {fa.format(page)}</span><button type="button" disabled={loading || page * 25 >= result.total} onClick={() => setPage((value) => value + 1)}>بعدی</button></div></div>
  </>;
}

function LeadCreate({ api }: { api: Api }) {
  const router = useRouter();
  async function create(values: Values, allowPotentialDuplicates: boolean) {
    const lead = await api<Lead>("/platform/crm/leads", { method: "POST", body: JSON.stringify({
      businessName: values.businessName, contactName: values.contactName || null, phone: values.phone || null, email: values.email || null,
      city: values.city || null, website: values.website || null, instagram: values.instagram || null, description: values.description || null,
      source: values.source, priority: values.priority, ownerId: values.ownerId || null,
      organizationId: values.organizationId || null, primaryContactId: values.primaryContactId || null, allowPotentialDuplicates,
    }) });
    router.push(`/platform/crm/leads/${lead.id}`);
  }
  return <><LeadBreadcrumb title="افزودن سرنخ" /><LeadEditor api={api} onSubmit={create} submitLabel="ثبت سرنخ" /></>;
}

function LeadEditor({ api, initial, leadId, onSubmit, onCancel, submitLabel }: { api: Api; initial?: Partial<Lead>; leadId?: string; onSubmit: (values: Values, allowPotentialDuplicates: boolean) => Promise<void>; onCancel?: () => void; submitLabel: string }) {
  const [values, setValues] = useState<Values>({ ...emptyValues(), ...initial, contactName: initial?.contactName ?? "", phone: initial?.phone ?? "", email: initial?.email ?? "", city: initial?.city ?? "", website: initial?.website ?? "", instagram: initial?.instagram ?? "", description: initial?.description ?? "", ownerId: initial?.ownerId ?? "", organizationId: initial?.organizationId ?? "", primaryContactId: initial?.primaryContactId ?? "" });
  const [assignees, setAssignees] = useState<UserOption[]>([]);
  const [organizationQuery, setOrganizationQuery] = useState(initial?.organizationName ?? "");
  const [organizations, setOrganizations] = useState<{ id: string; name: string; city: string | null }[]>([]);
  const [contacts, setContacts] = useState<{ id: string; name: string; role: string | null }[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void api<UserOption[]>("/platform/crm/leads/assignees").then(setAssignees).catch((reason) => setError((reason as Error).message)); }, [api]);
  useEffect(() => {
    let cancelled = false;
    const query = encode({ q: organizationQuery, page: "1", pageSize: "25", archiveStatus: "ACTIVE", sort: "name", direction: "ASC" });
    void api<Page<{ id: string; name: string; city: string | null }>>(`/platform/crm/organizations?${query}`).then((result) => { if (!cancelled) setOrganizations(result.items); }).catch(() => { if (!cancelled) setOrganizations([]); });
    return () => { cancelled = true; };
  }, [api, organizationQuery]);
  useEffect(() => {
    let cancelled = false;
    if (!values.organizationId) { setContacts([]); return; }
    const query = new URLSearchParams({ page: "1", pageSize: "100", archiveStatus: "ACTIVE", sort: "name", direction: "ASC" }).toString();
    void api<Page<{ id: string; name: string; role: string | null }>>(`/platform/crm/organizations/${values.organizationId}/contacts?${query}`).then((result) => { if (!cancelled) setContacts(result.items); }).catch(() => { if (!cancelled) setContacts([]); });
    return () => { cancelled = true; };
  }, [api, values.organizationId]);
  const field = (key: keyof Values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setValues((current) => ({ ...current, [key]: event.target.value })); setCandidates([]); setConfirmed(false); setError(""); };
  async function checkDuplicates() {
    const identityFields = ["businessName", "contactName", "phone", "email", "city", "website", "instagram"] as const;
    if (leadId && initial && identityFields.every((key) => values[key] === (initial[key] ?? ""))) return false;
    const fields = { businessName: values.businessName, contactName: values.contactName, phone: values.phone, email: values.email, city: values.city, website: values.website, instagram: values.instagram, ...(leadId ? { excludeId: leadId } : {}) };
    const found = await api<Candidate[]>("/platform/crm/leads/duplicate-candidates", { method: "POST", body: JSON.stringify(Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ""))) });
    const remaining = found.filter((item) => !(item.type === "ORGANIZATION" && item.id === values.organizationId) && !(item.type === "CONTACT" && item.id === values.primaryContactId));
    if (remaining.length) { setCandidates(remaining); return true; }
    return false;
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setSaving(true);
    try { if (!confirmed && await checkDuplicates()) return; await onSubmit(values, confirmed); }
    catch (reason) {
      const detail = reason as ApiError;
      if (detail.data?.candidates?.length) setCandidates(detail.data.candidates);
      setError((reason as Error).message);
    } finally { setSaving(false); }
  }
  const useCandidate = (candidate: Candidate) => {
    if (candidate.type === "ORGANIZATION") setValues((current) => ({ ...current, organizationId: candidate.id, primaryContactId: "" }));
    if (candidate.type === "CONTACT" && candidate.organizationId) setValues((current) => ({ ...current, organizationId: candidate.organizationId!, primaryContactId: candidate.id }));
    setCandidates([]); setConfirmed(false); setError("");
  };
  return <form className="form crm-form crm-lead-form" onSubmit={(event) => void submit(event)}>
    {error && <p className="message error" role="alert" tabIndex={-1}>{error}</p>}
    <label>نام کسب‌وکار<input required maxLength={160} value={values.businessName} onChange={field("businessName")} /></label>
    <label>نام فرد رابط<input maxLength={160} value={values.contactName} onChange={field("contactName")} /></label>
    <label>شماره همراه<input dir="ltr" inputMode="tel" autoComplete="tel" maxLength={32} value={values.phone} onChange={field("phone")} /></label>
    <label>ایمیل<input dir="ltr" type="email" autoComplete="email" maxLength={254} value={values.email} onChange={field("email")} /></label>
    <label>شهر<input maxLength={100} value={values.city} onChange={field("city")} /></label>
    <label>منبع<select value={values.source} onChange={field("source")}>{Object.entries(sources).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label>اولویت<select value={values.priority} onChange={field("priority")}>{Object.entries(priorities).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label>مسئول پیگیری<select value={values.ownerId} onChange={field("ownerId")}><option value="">بدون مسئول</option>{assignees.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>جست‌وجوی سازمان<input value={organizationQuery} onChange={(event) => setOrganizationQuery(event.target.value)} placeholder="نام یا شهر سازمان" /></label>
    <label>سازمان موجود<select value={values.organizationId} onChange={(event) => { const organizationId = event.target.value; const selected = organizations.find((item) => item.id === organizationId); setValues((current) => ({ ...current, organizationId, primaryContactId: "" })); if (selected) setOrganizationQuery(selected.name); setCandidates([]); setConfirmed(false); }}><option value="">هنوز پیوندی ندارد</option>{initial?.organizationId && !organizations.some((item) => item.id === initial.organizationId) && <option value={initial.organizationId}>{initial.organizationName ?? "سازمان فعلی"}</option>}{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}{item.city ? ` · ${item.city}` : ""}</option>)}</select></label>
    <label>فرد رابط موجود<select value={values.primaryContactId} disabled={!values.organizationId} onChange={field("primaryContactId")}><option value="">بدون پیوند</option>{initial?.primaryContactId && !contacts.some((item) => item.id === initial.primaryContactId) && <option value={initial.primaryContactId}>{initial.primaryContact?.name ?? "فرد رابط فعلی"}</option>}{contacts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.role ? ` · ${item.role}` : ""}</option>)}</select></label>
    <label>وب‌سایت<input dir="ltr" inputMode="url" autoComplete="url" maxLength={500} value={values.website} onChange={field("website")} placeholder="example.ir" /></label>
    <label>اینستاگرام<input dir="ltr" maxLength={255} value={values.instagram} onChange={field("instagram")} placeholder="@cafename" /></label>
    <label className="crm-lead-description">اطلاعات تکمیلی<textarea maxLength={1000} value={values.description} onChange={field("description")} rows={3} /></label>
    {values.organizationId && <p className="crm-linked-record">سازمان متصل انتخاب شد. سرنخ جدید نیز جداگانه ثبت می‌شود.</p>}
    {candidates.length > 0 && <section className="crm-duplicate crm-lead-duplicates" aria-labelledby="crm-lead-duplicates-title"><h2 id="crm-lead-duplicates-title">موارد مشابه پیدا شد</h2><p>برای جلوگیری از رکورد تکراری، می‌توانید به سازمان یا فرد موجود پیوند دهید. اطلاعات آن‌ها خودکار تغییر نمی‌کند.</p><ul>{candidates.map((item) => <li key={`${item.type}:${item.id}`}><span>{candidateName(item)}{item.city ? ` — ${item.city}` : item.organizationName ? ` · ${item.organizationName}` : ""}</span><small>{candidateKind(item)} · تطبیق: {item.matchingFields.map((key) => matchNames[key] ?? key).join("، ")}{item.status ? ` · ${statuses[item.status] ?? item.status}` : ""}</small><div>{item.type === "LEAD" ? <Link href={`/platform/crm/leads/${item.id}`}>بازکردن سرنخ</Link> : <button type="button" onClick={() => useCandidate(item)}>{item.type === "ORGANIZATION" ? "پیوند به این سازمان" : "پیوند به این فرد"}</button>}</div></li>)}</ul><button type="button" onClick={() => { setConfirmed(true); setCandidates([]); setError(""); }}>پس از بررسی، سرنخ جداگانه بساز</button></section>}
    <div className="crm-form-actions"><button disabled={saving}>{saving ? "در حال ذخیره…" : confirmed ? "ثبت با وجود موارد مشابه" : submitLabel}</button>{onCancel ? <button className="crm-secondary" type="button" onClick={onCancel}>انصراف</button> : <Link href="/platform/crm/leads">انصراف</Link>}</div>
  </form>;
}

function LeadDetail({ api, canManage, leadId }: { api: Api; canManage: boolean; leadId: string }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [changing, setChanging] = useState(false);
  const [qualifying, setQualifying] = useState(false);
  const [unqualifying, setUnqualifying] = useState(false);
  const [converting, setConverting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archivingBusy, setArchivingBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setLead(await api<Lead>(`/platform/crm/leads/${leadId}`)); }
    catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }, [api, leadId]);
  useEffect(() => { void load(); }, [load]);
  async function saveEdit(values: Values, allowPotentialDuplicates: boolean) {
    try {
      const links = { ...(values.organizationId !== (lead?.organizationId ?? "") ? { organizationId: values.organizationId || null } : {}), ...(values.primaryContactId !== (lead?.primaryContactId ?? "") ? { primaryContactId: values.primaryContactId || null } : {}) };
      const updated = await api<Lead>(`/platform/crm/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ businessName: values.businessName, contactName: values.contactName || null, phone: values.phone || null, email: values.email || null, city: values.city || null, website: values.website || null, instagram: values.instagram || null, description: values.description || null, priority: values.priority, ownerId: values.ownerId || null, ...links, allowPotentialDuplicates }) });
      setLead(updated); setEditing(false); setNotice("اطلاعات سرنخ ذخیره شد.");
    } catch (reason) { throw reason; }
  }
  async function changeArchive(archive: boolean) {
    setArchivingBusy(true); setError("");
    try { setLead(await api<Lead>(`/platform/crm/leads/${leadId}/${archive ? "archive" : "restore"}`, { method: "POST" })); setNotice(archive ? "سرنخ بایگانی شد؛ اطلاعات و ارتباط‌ها حفظ شده‌اند." : "سرنخ بازیابی شد."); setArchiving(false); }
    catch (reason) { setError((reason as Error).message); }
    finally { setArchivingBusy(false); }
  }
  if (loading && !lead) return <p className="empty" role="status">در حال دریافت سرنخ…</p>;
  if (error && !lead) return <><LeadBreadcrumb title="سرنخ پیدا نشد" /><p className="message error" role="alert">{error}</p><Link href="/platform/crm/leads">بازگشت به سرنخ‌ها</Link></>;
  if (!lead) return null;
  const canQualify = ["CONTACTED", "NURTURING"].includes(lead.status);
  const canUnqualify = ["NEW", "ATTEMPTING_CONTACT", "CONTACTED", "QUALIFIED", "NURTURING"].includes(lead.status);
  const next = nextStatuses(lead.status);
  const initial = { ...lead, source: lead.source, priority: lead.priority, ownerId: lead.ownerId ?? "", organizationId: lead.organizationId ?? "", primaryContactId: lead.primaryContactId ?? "" };
  return <><LeadBreadcrumb title={lead.businessName} />
    {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success" role="status">{notice}</p>}
    {lead.archivedAt && <p className="message warning">این سرنخ بایگانی شده است؛ سوابق و پیوندها حفظ شده‌اند.</p>}
    {editing && canManage ? <section className="crm-lead-panel"><header className="crm-section-heading"><h2>ویرایش سرنخ</h2></header><LeadEditor key={`${lead.id}:${lead.updatedAt}`} api={api} initial={initial} leadId={lead.id} onSubmit={saveEdit} submitLabel="ذخیره تغییرات" onCancel={() => setEditing(false)} /></section> : <section className="detail crm-lead-detail"><header className="crm-lead-detail-heading"><div><h1>{lead.businessName}</h1><p>{lead.contactName || "فرد رابط ثبت نشده"}{lead.city ? ` · ${lead.city}` : ""}</p></div><span className={`crm-status crm-status-${lead.status.toLowerCase()}`}>{statuses[lead.status] ?? lead.status}</span></header>
      {canManage && <div className="crm-actions crm-lead-actions">{!lead.archivedAt && lead.status !== "CONVERTED" && <button type="button" onClick={() => setEditing(true)}>ویرایش</button>}{!lead.archivedAt && (lead.status === "CONVERTED" || (lead.status === "QUALIFIED" && lead.organizationId)) && <Link className="crm-button" href={`/platform/crm/deals/new?leadId=${lead.id}`}>ایجاد فرصت فروش</Link>}{lead.archivedAt ? <button type="button" disabled={archivingBusy} onClick={() => void changeArchive(false)}>بازیابی سرنخ</button> : archiving ? <><span>سرنخ بایگانی شود؟</span><button type="button" disabled={archivingBusy} onClick={() => void changeArchive(true)}>بله، بایگانی کن</button><button type="button" className="crm-secondary" onClick={() => setArchiving(false)}>انصراف</button></> : <button type="button" className="crm-danger" onClick={() => setArchiving(true)}>بایگانی سرنخ</button>}</div>}
      <dl className="crm-facts"><div><dt>منبع</dt><dd>{sources[lead.source] ?? lead.source}</dd></div><div><dt>مسئول</dt><dd>{lead.ownerLabel || "بدون مسئول"}</dd></div><div><dt>اولویت</dt><dd>{priorities[lead.priority] ?? lead.priority}</dd></div><div><dt>شماره همراه</dt><dd dir="ltr">{lead.phone || "ثبت نشده"}</dd></div><div><dt>ایمیل</dt><dd dir="ltr">{lead.email || "ثبت نشده"}</dd></div><div><dt>وب‌سایت</dt><dd dir="ltr">{lead.website || "ثبت نشده"}</dd></div><div><dt>اینستاگرام</dt><dd dir="ltr">{lead.instagram ? `@${lead.instagram}` : "ثبت نشده"}</dd></div><div><dt>تاریخ ثبت</dt><dd>{formatDate(lead.createdAt)}</dd></div><div><dt>تاریخ احراز شرایط</dt><dd>{formatDate(lead.qualifiedAt)}</dd></div><div><dt>تاریخ تبدیل</dt><dd>{formatDate(lead.convertedAt)}</dd></div></dl>
      {lead.description && <section className="crm-lead-context"><h2>اطلاعات تکمیلی</h2><p>{lead.description}</p></section>}
      {lead.sourceRequest && <section className="crm-lead-context"><h2>درخواست اولیه از سایت</h2><p>{stages[lead.sourceRequest.businessStage] ?? lead.sourceRequest.businessStage} · {(lead.sourceRequest.requestedServices ?? []).map((item) => services[item] ?? item).join("، ")}</p><small>ارسال‌شده در {formatDate(lead.sourceRequest.createdAt)}</small></section>}
      {lead.qualificationNotes && <section className="crm-lead-context"><h2>یادداشت احراز شرایط</h2><p>{lead.qualificationNotes}</p></section>}
      {lead.unqualifiedReason && <section className="crm-lead-context"><h2>دلیل نامتناسب بودن</h2><p>{reasons[lead.unqualifiedReason] ?? lead.unqualifiedReason}{lead.unqualifiedReasonDetail ? ` · ${lead.unqualifiedReasonDetail}` : ""}</p></section>}
      {lead.organizationId && <section className="crm-lead-context"><h2>سازمان متصل</h2><p><Link href={`/platform/crm/organizations/${lead.organizationId}`}>{lead.organizationName}</Link></p>{lead.primaryContact && <p>فرد رابط: {lead.primaryContact.name}{lead.primaryContact.role ? ` · ${lead.primaryContact.role}` : ""}</p>}</section>}
    </section>}
    {canManage && !editing && !lead.archivedAt && <section className="crm-lead-panel"><header className="crm-section-heading"><div><h2>اقدام بعدی</h2><p>وضعیت‌ها بر اساس چرخه سرنخ کنترل می‌شوند.</p></div></header>
      {next.length > 0 && <div className="crm-lead-action-row"><button type="button" onClick={() => setChanging((value) => !value)}>تغییر وضعیت</button>{canQualify && <button type="button" onClick={() => setQualifying((value) => !value)}>احراز شرایط</button>}{canUnqualify && <button type="button" className="crm-secondary" onClick={() => setUnqualifying((value) => !value)}>نامتناسب</button>}</div>}
      {lead.status === "QUALIFIED" && <div className="crm-lead-action-row"><button type="button" onClick={() => setConverting((value) => !value)}>تبدیل به سازمان و ارتباط</button>{canUnqualify && <button type="button" className="crm-secondary" onClick={() => setUnqualifying((value) => !value)}>نامتناسب</button>}</div>}
      {changing && <StatusForm lead={lead} api={api} onDone={(updated) => { setLead(updated); setChanging(false); setNotice("وضعیت سرنخ به‌روز شد."); }} onError={setError} />}
      {qualifying && <QualificationForm api={api} lead={lead} onDone={(updated) => { setLead(updated); setQualifying(false); setNotice("سرنخ واجد شرایط ثبت شد."); }} onError={setError} />}
      {unqualifying && <UnqualificationForm api={api} lead={lead} onDone={(updated) => { setLead(updated); setUnqualifying(false); setNotice("دلیل نامتناسب بودن ثبت شد."); }} onError={setError} />}
      {converting && <ConversionForm api={api} lead={lead} onDone={(updated) => { setLead(updated); setConverting(false); setNotice("سرنخ به سازمان و ارتباط تبدیل شد."); }} onError={setError} onCancel={() => setConverting(false)} />}
    </section>}
    <section className="crm-lead-panel" aria-labelledby="crm-lead-history-title"><header className="crm-section-heading"><div><h2 id="crm-lead-history-title">سوابق وضعیت</h2><p>تغییرهای وضعیت همراه با زمان و مسئول ثبت شده‌اند.</p></div></header>{lead.statusHistory?.length ? <ol className="crm-lead-history">{[...lead.statusHistory].reverse().map((item) => <li key={item.id}><span className={`crm-status crm-status-${item.nextStatus.toLowerCase()}`}>{statuses[item.nextStatus] ?? item.nextStatus}</span><small>{formatDate(item.createdAt)}{item.actorLabel ? ` · ${item.actorLabel}` : " · ثبت سامانه"}</small>{item.reason && <p>{item.reason}</p>}</li>)}</ol> : <p className="empty crm-empty">تاریخچه‌ای ثبت نشده است.</p>}</section>
    <CrmWorkSections api={api} canManage={canManage && !lead.archivedAt} context={{ organizationId: lead.organizationId, contactId: lead.primaryContactId, leadId: lead.id, displayName: lead.businessName }} />
  </>;
}

function StatusForm({ api, lead, onDone, onError }: { api: Api; lead: Lead; onDone: (lead: Lead) => void; onError: (message: string) => void }) {
  const [status, setStatus] = useState(nextStatuses(lead.status)[0] ?? "");
  const [reason, setReason] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); onError(""); try { onDone(await api<Lead>(`/platform/crm/leads/${lead.id}/status`, { method: "POST", body: JSON.stringify({ status, reason: reason || null }) })); } catch (error) { onError((error as Error).message); } finally { setSaving(false); } }
  return <form className="crm-state-form" onSubmit={(event) => void submit(event)}><label>وضعیت جدید<select value={status} onChange={(event) => setStatus(event.target.value)}>{nextStatuses(lead.status).map((item) => <option key={item} value={item}>{statuses[item]}</option>)}</select></label><label>توضیح کوتاه<input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button disabled={saving || !status}>{saving ? "در حال ذخیره…" : "ثبت وضعیت"}</button></form>;
}

function QualificationForm({ api, lead, onDone, onError }: { api: Api; lead: Lead; onDone: (lead: Lead) => void; onError: (message: string) => void }) {
  const [notes, setNotes] = useState(lead.qualificationNotes ?? ""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); onError(""); try { onDone(await api<Lead>(`/platform/crm/leads/${lead.id}/qualify`, { method: "POST", body: JSON.stringify({ qualificationNotes: notes || null }) })); } catch (error) { onError((error as Error).message); } finally { setSaving(false); } }
  return <form className="crm-state-form" onSubmit={(event) => void submit(event)}><label>زمینه احراز شرایط (اختیاری)<textarea rows={3} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button disabled={saving}>{saving ? "در حال ذخیره…" : "تأیید و احراز شرایط"}</button></form>;
}

function UnqualificationForm({ api, lead, onDone, onError }: { api: Api; lead: Lead; onDone: (lead: Lead) => void; onError: (message: string) => void }) {
  const [reason, setReason] = useState("NOT_INTERESTED"); const [detail, setDetail] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); onError(""); try { onDone(await api<Lead>(`/platform/crm/leads/${lead.id}/unqualify`, { method: "POST", body: JSON.stringify({ reason, detail: reason === "OTHER" ? detail || null : null }) })); } catch (error) { onError((error as Error).message); } finally { setSaving(false); } }
  return <form className="crm-state-form" onSubmit={(event) => void submit(event)}><label>دلیل<select value={reason} onChange={(event) => setReason(event.target.value)}>{Object.entries(reasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{reason === "OTHER" && <label>جزئیات اختیاری<input maxLength={500} value={detail} onChange={(event) => setDetail(event.target.value)} /></label>}<button disabled={saving}>{saving ? "در حال ذخیره…" : "ثبت دلیل و بستن سرنخ"}</button></form>;
}

function ConversionForm({ api, lead, onDone, onError, onCancel }: { api: Api; lead: Lead; onDone: (lead: Lead) => void; onError: (message: string) => void; onCancel: () => void }) {
  const [organizationMode, setOrganizationMode] = useState<"CREATE" | "LINK">(lead.organizationId ? "LINK" : "CREATE");
  const [organizationId, setOrganizationId] = useState(lead.organizationId ?? "");
  const [organizationQuery, setOrganizationQuery] = useState(lead.organizationName ?? "");
  const [organizations, setOrganizations] = useState<{ id: string; name: string; city: string | null }[]>([]);
  const [contactMode, setContactMode] = useState<"CREATE" | "LINK">(lead.primaryContactId ? "LINK" : "CREATE");
  const [contactId, setContactId] = useState(lead.primaryContactId ?? "");
  const [contacts, setContacts] = useState<{ id: string; name: string; role: string | null }[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (organizationMode !== "LINK") return;
    const query = encode({ q: organizationQuery, page: "1", pageSize: "25", archiveStatus: "ACTIVE", sort: "name", direction: "ASC" });
    void api<Page<{ id: string; name: string; city: string | null }>>(`/platform/crm/organizations?${query}`).then((result) => { if (!cancelled) setOrganizations(result.items); }).catch(() => { if (!cancelled) setOrganizations([]); });
    return () => { cancelled = true; };
  }, [api, organizationMode, organizationQuery]);
  useEffect(() => {
    let cancelled = false;
    if (organizationMode !== "LINK" || !organizationId) { setContacts([]); return; }
    const query = new URLSearchParams({ page: "1", pageSize: "100", archiveStatus: "ACTIVE", sort: "name", direction: "ASC" }).toString();
    void api<Page<{ id: string; name: string; role: string | null }>>(`/platform/crm/organizations/${organizationId}/contacts?${query}`).then((result) => { if (!cancelled) setContacts(result.items); }).catch(() => { if (!cancelled) setContacts([]); });
    return () => { cancelled = true; };
  }, [api, organizationMode, organizationId]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); onError("");
    try {
      const converted = await api<Lead>(`/platform/crm/leads/${lead.id}/convert`, { method: "POST", body: JSON.stringify({ organizationMode, ...(organizationMode === "LINK" ? { organizationId } : {}), contactMode, ...(contactMode === "LINK" ? { contactId } : {}), confirmPotentialDuplicates: confirmDuplicates }) });
      onDone(converted);
    } catch (reason) {
      const details = reason as ApiError;
      if (details.data?.candidates?.length) setCandidates(details.data.candidates);
      onError((reason as Error).message);
    } finally { setSaving(false); }
  }
  const useCandidate = (candidate: Candidate) => {
    if (candidate.type === "ORGANIZATION") { setOrganizationMode("LINK"); setOrganizationId(candidate.id); setOrganizationQuery(candidate.businessName ?? ""); setContactMode("CREATE"); setContactId(""); }
    if (candidate.type === "CONTACT" && candidate.organizationId) { setOrganizationMode("LINK"); setOrganizationId(candidate.organizationId); setOrganizationQuery(candidate.organizationName ?? ""); setContactMode("LINK"); setContactId(candidate.id); }
    setCandidates([]); setConfirmDuplicates(false);
  };
  return <form className="crm-state-form crm-conversion-form" onSubmit={(event) => void submit(event)}>
    <p>تبدیل فقط سازمان و فرد رابط را ایجاد یا پیوند می‌دهد. وضعیت مالی یا اشتراک تغییری نمی‌کند.</p>
    <label>سازمان<select value={organizationMode} onChange={(event) => { setOrganizationMode(event.target.value as "CREATE" | "LINK"); setOrganizationId(""); setContactId(""); if (event.target.value === "CREATE") setContactMode("CREATE"); }}><option value="CREATE">ایجاد سازمان از اطلاعات سرنخ</option><option value="LINK">پیوند به سازمان موجود</option></select></label>
    {organizationMode === "LINK" && <><label>جست‌وجوی سازمان<input value={organizationQuery} onChange={(event) => setOrganizationQuery(event.target.value)} /></label><label>سازمان<select required value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setContactId(""); setContactMode("CREATE"); }}><option value="">انتخاب کنید</option>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}{item.city ? ` · ${item.city}` : ""}</option>)}</select></label></>}
    <label>فرد رابط<select value={contactMode} onChange={(event) => { setContactMode(event.target.value as "CREATE" | "LINK"); setContactId(""); }}><option value="CREATE" disabled={!lead.contactName}>ایجاد ارتباط از اطلاعات سرنخ</option><option value="LINK" disabled={organizationMode !== "LINK" || !organizationId}>پیوند به ارتباط موجود</option></select></label>
    {contactMode === "LINK" && <label>ارتباط<select required value={contactId} onChange={(event) => setContactId(event.target.value)}><option value="">انتخاب کنید</option>{contacts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.role ? ` · ${item.role}` : ""}</option>)}</select></label>}
    {candidates.length > 0 && <section className="crm-duplicate crm-lead-duplicates"><h3>موارد مشابه</h3><p>رکورد مناسب را پیوند دهید یا پس از بررسی ادامه دهید.</p><ul>{candidates.map((item) => <li key={`${item.type}:${item.id}`}><span>{candidateName(item)}{item.city ? ` — ${item.city}` : item.organizationName ? ` · ${item.organizationName}` : ""}</span><small>{candidateKind(item)} · {item.matchingFields.map((key) => matchNames[key] ?? key).join("، ")}</small>{item.type !== "LEAD" && <button type="button" onClick={() => useCandidate(item)}>پیوند به این رکورد</button>}</li>)}</ul><button type="button" onClick={() => { setConfirmDuplicates(true); setCandidates([]); }}>ادامه با ایجاد رکورد جداگانه</button></section>}
    {!lead.contactName && contactMode === "CREATE" && <p>برای تبدیل، نام فرد رابط را در سرنخ ثبت کنید یا یک ارتباط موجود را پیوند دهید.</p>}
    <div className="crm-form-actions"><button disabled={saving || (organizationMode === "LINK" && !organizationId) || (contactMode === "LINK" && !contactId) || (contactMode === "CREATE" && !lead.contactName)}>{saving ? "در حال تبدیل…" : confirmDuplicates ? "تأیید و تبدیل" : "تبدیل سرنخ"}</button><button type="button" className="crm-secondary" onClick={onCancel}>بستن</button></div>
  </form>;
}

function LeadBreadcrumb({ title }: { title: string }) { return <nav className="platform-nav-label crm-breadcrumb" aria-label="مسیر صفحه"><Link href="/platform/crm/leads">سرنخ‌ها</Link><span aria-hidden="true"> / </span><span>{title}</span></nav>; }
function candidateName(item: Candidate) { return item.type === "ORGANIZATION" ? item.businessName ?? "سازمان" : item.type === "CONTACT" ? item.contactName ?? "ارتباط" : item.businessName ?? "سرنخ"; }
function candidateKind(item: Candidate) { return item.type === "ORGANIZATION" ? "سازمان موجود" : item.type === "CONTACT" ? "ارتباط موجود" : "سرنخ موجود"; }
function nextStatuses(status: string): string[] {
  const next: Record<string, string[]> = { NEW: ["ATTEMPTING_CONTACT", "CONTACTED"], ATTEMPTING_CONTACT: ["CONTACTED", "NURTURING"], CONTACTED: ["ATTEMPTING_CONTACT", "NURTURING"], QUALIFIED: ["NURTURING"], NURTURING: ["ATTEMPTING_CONTACT", "CONTACTED"] };
  return next[status] ?? [];
}
