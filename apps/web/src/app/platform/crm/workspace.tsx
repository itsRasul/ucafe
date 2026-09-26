"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { PlatformApi as Api, usePlatformSession } from "../use-platform-session";
import { CrmWorkSections } from "./work";
import { Organization360 } from "./organization-360";

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type Organization = { id: string; name: string; city: string | null; website: string | null; instagram: string | null; coffeeShopId: string | null; tenant: { id: string; name: string; status: string } | null; archivedAt: string | null; createdAt: string; updatedAt: string; contactCount?: number };
type Contact = { id: string; organizationId: string; organizationName: string; name: string; role: string | null; archivedAt: string | null; createdAt: string; updatedAt: string; phone?: string | null; email?: string | null };
type Duplicate = { id: string; name: string; city?: string | null; role?: string | null; archivedAt: string | null; matchingFields: string[] };
type TenantOption = { id: string; name: string; status: string };
type Props = { mode: "list" | "create" | "detail" | "contact"; organizationId?: string; contactId?: string };
const fa = new Intl.NumberFormat("fa-IR");
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(value)) : "—";
const encode = (values: Record<string, string>) => new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""))).toString();

export function CrmWorkspace(props: Props) {
  const { state, access, api } = usePlatformSession();

  if (state === "loading") return <main className="platform-entry"><p>در حال بررسی دسترسی…</p></main>;
  if (state !== "ready") return <main className="platform-entry"><section><h1>{state === "denied" ? "دسترسی CRM فعال نیست" : "برای ورود دوباره به پلتفرم برگردید"}</h1><p>{state === "denied" ? "برای دیدن اطلاعات CRM به دسترسی crm.read نیاز دارید." : "نشست پلتفرم در دسترس نیست. ابتدا وارد پنل شوید."}</p><Link className="crm-button" href="/platform">بازگشت به پنل پلتفرم</Link></section></main>;
  if (!access.includes("crm.read")) return <main className="platform-entry"><section><h1>دسترسی CRM فعال نیست</h1><p>برای دیدن اطلاعات CRM به دسترسی crm.read نیاز دارید.</p><Link className="crm-button" href="/platform">بازگشت به پنل پلتفرم</Link></section></main>;
  if (props.mode === "create" && !access.includes("crm.manage")) return <main className="platform-entry"><section><h1>دسترسی مدیریت CRM فعال نیست</h1><p>برای ساخت سازمان به دسترسی crm.manage نیاز دارید.</p><Link className="crm-button" href="/platform/crm">بازگشت به سازمان‌ها</Link></section></main>;

  return <CrmShell canManage={access.includes("crm.manage")}>
    {props.mode === "list" && <OrganizationDirectory api={api} canManage={access.includes("crm.manage")} />}
    {props.mode === "create" && <OrganizationCreate api={api} canLinkTenant={access.includes("tenants.read")} />}
    {props.mode === "detail" && props.organizationId && <OrganizationDetail api={api} canManage={access.includes("crm.manage")} canLinkTenant={access.includes("tenants.read")} organizationId={props.organizationId} />}
    {props.mode === "contact" && props.contactId && <ContactDetail api={api} canManage={access.includes("crm.manage")} contactId={props.contactId} />}
  </CrmShell>;
}

export function CrmShell({ children, canManage }: { children: React.ReactNode; canManage: boolean }) {
  return <main className="platform-app crm-app"><div className="platform-frame">
    <aside className="platform-sidebar"><div><div className="platform-brand"><span><strong>CRM یو کافه</strong><small>سازمان‌ها و ارتباط‌ها</small></span></div><p className="platform-nav-label">فضای کاری CRM</p><nav aria-label="ناوبری CRM"><Link className="platform-crm-link" href="/platform/crm">سازمان‌ها</Link><Link className="platform-crm-link" href="/platform/crm/leads">سرنخ‌ها</Link><Link className="platform-crm-link" href="/platform/crm/pipeline">خط فروش</Link><Link className="platform-crm-link" href="/platform/crm/deals">فرصت‌ها</Link><Link className="platform-crm-link" href="/platform/crm/tasks">وظایف</Link>{canManage && <><Link className="platform-crm-link" href="/platform/crm/organizations/new">افزودن سازمان</Link><Link className="platform-crm-link" href="/platform/crm/leads/new">افزودن سرنخ</Link><Link className="platform-crm-link" href="/platform/crm/deals/new">فرصت جدید</Link></>}</nav></div><Link className="crm-back" href="/platform">بازگشت به پلتفرم</Link></aside>
    <section className="platform-shell"><header className="platform-topbar"><strong>مدیریت ارتباط‌های تجاری</strong><Link href="/platform">پنل پلتفرم</Link></header><div className="crm-content">{children}</div><nav className="platform-bottom-nav" aria-label="ناوبری موبایل CRM"><Link className="platform-crm-link" href="/platform/crm">سازمان‌ها</Link><Link className="platform-crm-link" href="/platform/crm/leads">سرنخ‌ها</Link><Link className="platform-crm-link" href="/platform/crm/pipeline">خط فروش</Link><Link className="platform-crm-link" href="/platform/crm/deals">فرصت‌ها</Link><Link className="platform-crm-link" href="/platform/crm/tasks">وظایف</Link></nav></section>
  </div></main>;
}

function OrganizationDirectory({ api, canManage }: { api: Api; canManage: boolean }) {
  const [items, setItems] = useState<Organization[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [archiveStatus, setArchiveStatus] = useState("ACTIVE");
  const [tenantLink, setTenantLink] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [direction, setDirection] = useState("DESC");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    const query = encode({ q, city, archiveStatus, tenantLink, sort, direction, page: String(page), pageSize: "25" });
    void api<Page<Organization>>(`/platform/crm/organizations?${query}`).then((result) => { if (!cancelled) { setItems(result.items); setTotal(result.total); } }).catch((reason) => { if (!cancelled) setError((reason as Error).message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, q, city, archiveStatus, tenantLink, sort, direction, page]);

  return <><header className="crm-heading"><div><p className="platform-nav-label">پلتفرم / CRM</p><h1>سازمان‌ها</h1><p>کافه‌ها و مجموعه‌هایی که UCafe با آن‌ها در ارتباط است.</p></div>{canManage && <Link className="crm-button" href="/platform/crm/organizations/new">افزودن سازمان</Link>}</header>
    <form className="crm-filters" onSubmit={(event) => { event.preventDefault(); setPage(1); }}>
      <label>جست‌وجو<input value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} placeholder="نام، وب‌سایت یا اینستاگرام" /></label>
      <label>شهر<input value={city} onChange={(event) => { setCity(event.target.value); setPage(1); }} placeholder="همه شهرها" /></label>
      <label>ارتباط با کافه<select value={tenantLink} onChange={(event) => { setTenantLink(event.target.value); setPage(1); }}><option value="">همه</option><option value="LINKED">متصل به کافه</option><option value="UNLINKED">بدون کافه</option></select></label>
      <label>نمایش<select value={archiveStatus} onChange={(event) => { setArchiveStatus(event.target.value); setPage(1); }}><option value="ACTIVE">فعال</option><option value="ARCHIVED">بایگانی‌شده</option><option value="ALL">همه</option></select></label>
      <label>مرتب‌سازی<select value={`${sort}:${direction}`} onChange={(event) => { const [nextSort, nextDirection] = event.target.value.split(":"); setSort(nextSort!); setDirection(nextDirection!); }}><option value="createdAt:DESC">جدیدترین</option><option value="createdAt:ASC">قدیمی‌ترین</option><option value="name:ASC">نام، الف تا ی</option><option value="name:DESC">نام، ی تا الف</option><option value="city:ASC">شهر</option></select></label>
    </form>
    {error && <p className="message error" role="alert">{error}</p>}
    {loading ? <p className="empty" aria-live="polite">در حال دریافت سازمان‌ها…</p> : items.length === 0 ? <div className="empty"><strong>{archiveStatus === "ACTIVE" ? "هنوز سازمانی در CRM ثبت نشده است." : "سازمانی با این شرایط پیدا نشد."}</strong><p>{archiveStatus === "ACTIVE" && "اولین کافه یا مجموعه را اضافه کنید."}</p>{canManage && archiveStatus === "ACTIVE" && <Link className="crm-button" href="/platform/crm/organizations/new">افزودن اولین سازمان</Link>}</div> : <div className="crm-org-list" aria-label="فهرست سازمان‌ها">{items.map((item) => <Link className="crm-org-row" key={item.id} href={`/platform/crm/organizations/${item.id}`}><span><strong>{item.name}</strong><small>{item.city || "شهر ثبت نشده"} · {item.tenant ? `کافه متصل: ${item.tenant.name}` : "بدون کافه متصل"}</small></span><span className="crm-row-meta"><small>{fa.format(item.contactCount ?? 0)} ارتباط</small><small>{item.archivedAt ? "بایگانی‌شده" : formatDate(item.createdAt)}</small></span></Link>)}</div>}
    <div className="crm-pagination"><span>مجموع: {fa.format(total)}</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>قبلی</button><span>صفحه {fa.format(page)}</span><button type="button" disabled={loading || page * 25 >= total} onClick={() => setPage((value) => value + 1)}>بعدی</button></div></div>
  </>;
}

function OrganizationCreate({ api, canLinkTenant }: { api: Api; canLinkTenant: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [values, setValues] = useState({ name: "", city: "", website: "", instagram: "", coffeeShopId: "" });
  useEffect(() => { if (canLinkTenant) void api<TenantOption[]>("/platform/crm/tenant-link-candidates").then(setTenantOptions).catch((reason) => setError((reason as Error).message)); }, [api, canLinkTenant]);
  const field = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setValues((current) => ({ ...current, [key]: event.target.value })); setDuplicates([]); setConfirmed(false); setError(""); };
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setSaving(true);
    try {
      if (!confirmed) {
        const query = encode({ name: values.name, city: values.city, website: values.website, instagram: values.instagram });
        const candidates = await api<Duplicate[]>(`/platform/crm/organizations/duplicate-candidates?${query}`);
        if (candidates.length) { setDuplicates(candidates); return; }
      }
      const organization = await api<Organization>("/platform/crm/organizations", { method: "POST", body: JSON.stringify({ name: values.name, city: values.city || null, website: values.website || null, instagram: values.instagram || null, coffeeShopId: canLinkTenant ? values.coffeeShopId || null : null }) });
      router.push(`/platform/crm/organizations/${organization.id}`);
    } catch (reason) { setError((reason as Error).message); } finally { setSaving(false); }
  }
  return <><CrmBreadcrumb title="افزودن سازمان" /><OrganizationFields values={values} field={field} tenantOptions={tenantOptions} canLinkTenant={canLinkTenant} onSubmit={submit} saving={saving} error={error} submitLabel={duplicates.length && !confirmed ? "بررسی موارد مشابه" : "ثبت سازمان"} />
    {duplicates.length > 0 && !confirmed && <section className="crm-duplicate" aria-labelledby="crm-org-duplicates"><h2 id="crm-org-duplicates">موارد مشابه پیدا شد</h2><p>پیش از ثبت، موارد زیر را بررسی کنید. CRM آن‌ها را خودکار ادغام نمی‌کند.</p><ul>{duplicates.map((item) => <li key={item.id}><Link href={`/platform/crm/organizations/${item.id}`}>{item.name}{item.city ? ` — ${item.city}` : ""}</Link><small> تطبیق: {item.matchingFields.map(matchLabel).join("، ")}</small></li>)}</ul><button type="button" onClick={() => setConfirmed(true)}>با وجود این موارد، ادامه بده</button></section>}
  </>;
}

function OrganizationFields({ values, field, tenantOptions, canLinkTenant, onSubmit, saving, error, submitLabel }: { values: { name: string; city: string; website: string; instagram: string; coffeeShopId: string }; field: (key: "name" | "city" | "website" | "instagram" | "coffeeShopId") => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void; tenantOptions: TenantOption[]; canLinkTenant: boolean; onSubmit: (event: FormEvent) => void; saving: boolean; error: string; submitLabel: string }) {
  return <form className="form crm-form" onSubmit={onSubmit}>
    {error && <p className="message error" role="alert" tabIndex={-1}>{error}</p>}
    <label>نام کسب‌وکار<input required maxLength={160} value={values.name} onChange={field("name")} /></label>
    <label>شهر<input maxLength={100} value={values.city} onChange={field("city")} /></label>
    <label>وب‌سایت<input inputMode="url" autoComplete="url" maxLength={500} value={values.website} onChange={field("website")} placeholder="example.ir" /><small>نشانی با یا بدون https:// پذیرفته می‌شود.</small></label>
    <label>نام کاربری اینستاگرام<input dir="ltr" maxLength={255} value={values.instagram} onChange={field("instagram")} placeholder="cafename یا @cafename" /></label>
    {canLinkTenant && <label>کافه متصل در UCafe<select value={values.coffeeShopId} onChange={field("coffeeShopId")}><option value="">بدون کافه متصل</option>{tenantOptions.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name} · {tenant.status}</option>)}</select><small>وضعیت کافه از سامانه اصلی خوانده می‌شود.</small></label>}
    <div className="crm-form-actions"><button disabled={saving}>{saving ? "در حال ذخیره…" : submitLabel}</button><Link href="/platform/crm">انصراف</Link></div>
  </form>;
}

function OrganizationDetail({ api, canManage, canLinkTenant, organizationId }: { api: Api; canManage: boolean; canLinkTenant: boolean; organizationId: string }) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [contacts, setContacts] = useState<Page<Contact>>({ items: [], total: 0, page: 1, pageSize: 25 });
  const [contactPage, setContactPage] = useState(1);
  const [contactQ, setContactQ] = useState("");
  const [contactArchive, setContactArchive] = useState("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [contactError, setContactError] = useState("");
  const [editing, setEditing] = useState(false);
  const [contactEditor, setContactEditor] = useState<{ id?: string } | null>(null);
  const [confirmOrgArchive, setConfirmOrgArchive] = useState(false);
  const [confirmContactArchive, setConfirmContactArchive] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError(""); setContactError("");
    try {
      const query = encode({ page: String(contactPage), pageSize: "25", q: contactQ, archiveStatus: contactArchive, sort: "name", direction: "ASC" });
      const [orgResult, contactPageResult, tenantChoices] = await Promise.allSettled([
        api<Organization>(`/platform/crm/organizations/${organizationId}`),
        api<Page<Contact>>(`/platform/crm/organizations/${organizationId}/contacts?${query}`),
        canLinkTenant ? api<TenantOption[]>(`/platform/crm/tenant-link-candidates?organizationId=${organizationId}`) : Promise.resolve([]),
      ]);
      if (orgResult.status === "rejected") throw orgResult.reason;
      setOrganization(orgResult.value);
      if (contactPageResult.status === "fulfilled") { setContacts(contactPageResult.value); setContactError(""); }
      else setContactError((contactPageResult.reason as Error).message);
      setTenantOptions(tenantChoices.status === "fulfilled" ? tenantChoices.value : []);
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }, [api, organizationId, contactPage, contactQ, contactArchive, canLinkTenant]);
  useEffect(() => { void load(); }, [load]);

  async function updateOrg(values: { name: string; city: string; website: string; instagram: string; coffeeShopId: string }) {
    await api(`/platform/crm/organizations/${organizationId}`, { method: "PATCH", body: JSON.stringify({ name: values.name, city: values.city || null, website: values.website || null, instagram: values.instagram || null, ...(canLinkTenant ? { coffeeShopId: values.coffeeShopId || null } : {}) }) });
    setEditing(false); setNotice("سازمان ذخیره شد."); await load();
  }
  async function archiveOrganization(archive: boolean) {
    await api(`/platform/crm/organizations/${organizationId}/${archive ? "archive" : "restore"}`, { method: "POST" });
    setConfirmOrgArchive(false); setNotice(archive ? "سازمان بایگانی شد؛ ارتباط‌های آن باقی ماندند." : "سازمان بازیابی شد."); await load();
  }
  async function archiveContact(contact: Contact, archive: boolean) {
    await api(`/platform/crm/contacts/${contact.id}/${archive ? "archive" : "restore"}`, { method: "POST" });
    setConfirmContactArchive(null); setNotice(archive ? "ارتباط بایگانی شد." : "ارتباط بازیابی شد."); await load();
  }

  if (loading && !organization) return <p className="empty" aria-live="polite">در حال دریافت سازمان…</p>;
  if (error && !organization) return <><CrmBreadcrumb title="سازمان پیدا نشد" /><p className="message error" role="alert">{error}</p><Link href="/platform/crm">بازگشت به سازمان‌ها</Link></>;
  if (!organization) return null;
  const orgValues = { name: organization.name, city: organization.city ?? "", website: organization.website ?? "", instagram: organization.instagram ?? "", coffeeShopId: organization.coffeeShopId ?? "" };
  return <><CrmBreadcrumb title={organization.name} />
    {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success" role="status">{notice}</p>}
    {organization.archivedAt && <p className="message warning">این سازمان بایگانی شده است. ارتباط‌های موجود حفظ شده‌اند.</p>}
    {editing && canManage ? <OrganizationFields values={orgValues} field={(key) => (event) => { const next = { ...orgValues, [key]: event.target.value }; setOrganization({ ...organization, ...next, tenant: organization.tenant }); }} tenantOptions={tenantOptions} canLinkTenant={canLinkTenant} onSubmit={async (event) => { event.preventDefault(); try { await updateOrg(orgValues); } catch (reason) { setError((reason as Error).message); } }} saving={false} error="" submitLabel="ذخیره تغییرات" /> : <section className="detail crm-org-detail"><header><div><h1>{organization.name}</h1><p>{organization.city || "شهر ثبت نشده"} · {organization.archivedAt ? "بایگانی‌شده" : "فعال"}</p></div>{canManage && <div className="crm-actions"><button type="button" onClick={() => setEditing(true)}>ویرایش</button>{organization.archivedAt ? <button type="button" onClick={() => void archiveOrganization(false)}>بازیابی سازمان</button> : confirmOrgArchive ? <><span>بایگانی شود؟</span><button type="button" onClick={() => void archiveOrganization(true)}>بله، بایگانی کن</button><button type="button" onClick={() => setConfirmOrgArchive(false)}>انصراف</button></> : <button type="button" className="crm-danger" onClick={() => setConfirmOrgArchive(true)}>بایگانی سازمان</button>}</div>}</header>
      <dl className="crm-facts"><div><dt>وب‌سایت</dt><dd>{organization.website ? <a href={organization.website} target="_blank" rel="noreferrer">{organization.website}</a> : "ثبت نشده"}</dd></div><div><dt>اینستاگرام</dt><dd>{organization.instagram ? <a href={`https://www.instagram.com/${organization.instagram}/`} target="_blank" rel="noreferrer">@{organization.instagram}</a> : "ثبت نشده"}</dd></div><div><dt>کافه متصل در UCafe</dt><dd>{organization.tenant ? `${organization.tenant.name} (${organization.tenant.status})` : "متصل نیست"}</dd></div><div><dt>تاریخ ثبت</dt><dd>{formatDate(organization.createdAt)}</dd></div><div><dt>آخرین تغییر</dt><dd>{formatDate(organization.updatedAt)}</dd></div></dl>
    </section>}
    <Organization360 key={organizationId} api={api} organizationId={organizationId} />
    <section className="crm-contacts" id="crm-contacts" aria-labelledby="crm-contacts-title"><header className="crm-section-heading"><div><h2 id="crm-contacts-title">ارتباط‌ها</h2><p>افرادی که با این کسب‌وکار در ارتباط هستند.</p></div>{canManage && !organization.archivedAt && <button type="button" onClick={() => setContactEditor({})}>افزودن ارتباط</button>}</header>
      {contactEditor && <ContactEditor key={contactEditor.id ?? "new"} api={api} organizationId={organizationId} contactId={contactEditor.id} onCancel={() => setContactEditor(null)} onSaved={async () => { setContactEditor(null); setNotice("اطلاعات ارتباط ذخیره شد."); await load(); }} />}
      <div className="crm-contact-filters"><label>جست‌وجوی ارتباط<input value={contactQ} onChange={(event) => { setContactQ(event.target.value); setContactPage(1); }} placeholder="نام، عنوان، شماره یا ایمیل" /></label><label>نمایش<select value={contactArchive} onChange={(event) => { setContactArchive(event.target.value); setContactPage(1); }}><option value="ACTIVE">فعال</option><option value="ARCHIVED">بایگانی‌شده</option><option value="ALL">همه</option></select></label></div>
      {loading ? <p className="empty">در حال دریافت ارتباط‌ها…</p> : contactError ? <p className="message error" role="alert">ارتباط‌ها بارگذاری نشدند. <button type="button" onClick={() => void load()}>تلاش دوباره</button></p> : contacts.items.length === 0 ? <div className="empty crm-empty"><strong>هنوز ارتباطی ثبت نشده است.</strong><p>می‌توانید مالک، مدیر یا فرد مرتبط دیگری را به این سازمان اضافه کنید.</p></div> : <div className="crm-contact-list">{contacts.items.map((contact) => <article key={contact.id} className="crm-contact-row"><div><strong><Link href={`/platform/crm/contacts/${contact.id}`}>{contact.name}</Link></strong><small>{contact.role || "عنوان شغلی ثبت نشده"}{contact.archivedAt ? " · بایگانی‌شده" : ""}</small><small>ثبت‌شده در {formatDate(contact.createdAt)}</small></div>{canManage && <div className="crm-actions">{!contact.archivedAt && !organization.archivedAt && <button type="button" onClick={() => setContactEditor({ id: contact.id })}>ویرایش</button>}{contact.archivedAt ? <button type="button" onClick={() => void archiveContact(contact, false)}>بازیابی</button> : confirmContactArchive === contact.id ? <><span>بایگانی شود؟</span><button type="button" onClick={() => void archiveContact(contact, true)}>بایگانی کن</button><button type="button" onClick={() => setConfirmContactArchive(null)}>انصراف</button></> : <button className="crm-danger" type="button" onClick={() => setConfirmContactArchive(contact.id)}>بایگانی</button>}</div>}</article>)}</div>}
      <div className="crm-pagination"><span>مجموع: {fa.format(contacts.total)}</span><div><button type="button" disabled={contactPage <= 1 || loading} onClick={() => setContactPage((value) => value - 1)}>قبلی</button><span>صفحه {fa.format(contactPage)}</span><button type="button" disabled={loading || contactPage * 25 >= contacts.total} onClick={() => setContactPage((value) => value + 1)}>بعدی</button></div></div>
    </section>
    <CrmWorkSections api={api} canManage={canManage && !organization.archivedAt} context={{ organizationId, displayName: organization.name }} />
  </>;
}

function ContactEditor({ api, organizationId, contactId, onCancel, onSaved }: { api: Api; organizationId: string; contactId?: string; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [values, setValues] = useState({ name: "", role: "", phone: "", email: "" });
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(Boolean(contactId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!contactId) return; let cancelled = false; void api<Contact>(`/platform/crm/contacts/${contactId}`).then((item) => { if (!cancelled) setValues({ name: item.name, role: item.role ?? "", phone: item.phone ?? "", email: item.email ?? "" }); }).catch((reason) => { if (!cancelled) setError((reason as Error).message); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [api, contactId]);
  const field = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => { setValues((current) => ({ ...current, [key]: event.target.value })); setDuplicates([]); setConfirmed(false); };
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setSaving(true);
    try {
      if (!confirmed) {
        const query = encode({ phone: values.phone, email: values.email, ...(contactId ? { excludeId: contactId } : {}) });
        const candidates = await api<Duplicate[]>(`/platform/crm/organizations/${organizationId}/contacts/duplicate-candidates?${query}`);
        if (candidates.length) { setDuplicates(candidates); return; }
      }
      const path = contactId ? `/platform/crm/contacts/${contactId}` : `/platform/crm/organizations/${organizationId}/contacts`;
      await api(path, { method: contactId ? "PATCH" : "POST", body: JSON.stringify({ name: values.name, role: values.role || null, phone: values.phone || null, email: values.email || null }) });
      await onSaved();
    } catch (reason) { setError((reason as Error).message); } finally { setSaving(false); }
  }
  if (loading) return <p className="crm-inline-loading">در حال دریافت اطلاعات ارتباط…</p>;
  return <form className="form crm-contact-form" onSubmit={submit}>
    <h3>{contactId ? "ویرایش ارتباط" : "افزودن ارتباط"}</h3>{error && <p className="message error" role="alert" tabIndex={-1}>{error}</p>}
    <label>نام و نام خانوادگی<input required maxLength={160} value={values.name} onChange={field("name")} /></label>
    <label>سمت یا عنوان شغلی<input maxLength={100} value={values.role} onChange={field("role")} placeholder="مثلاً مالک یا مدیر" /></label>
    <label>شماره موبایل<input dir="ltr" inputMode="tel" autoComplete="tel" maxLength={32} value={values.phone} onChange={field("phone")} placeholder="0912…" /></label>
    <label>ایمیل<input dir="ltr" type="email" autoComplete="email" maxLength={254} value={values.email} onChange={field("email")} /></label>
    <div className="crm-form-actions"><button disabled={saving}>{saving ? "در حال ذخیره…" : duplicates.length && !confirmed ? "بررسی موارد مشابه" : "ذخیره ارتباط"}</button><button type="button" className="crm-secondary" onClick={onCancel}>انصراف</button></div>
    {duplicates.length > 0 && !confirmed && <section className="crm-duplicate"><h4>ارتباط مشابه پیدا شد</h4><p>شماره یا ایمیل واردشده برای همین سازمان ثبت شده است.</p><ul>{duplicates.map((item) => <li key={item.id}><span>{item.name}{item.role ? ` — ${item.role}` : ""}</span><small>تطبیق: {item.matchingFields.map(matchLabel).join("، ")}</small></li>)}</ul><button type="button" onClick={() => setConfirmed(true)}>با وجود این مورد، ادامه بده</button></section>}
  </form>;
}

function ContactDetail({ api, canManage, contactId }: { api: Api; canManage: boolean; contactId: string }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setContact(await api<Contact>(`/platform/crm/contacts/${contactId}`)); }
    catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }, [api, contactId]);
  useEffect(() => { void load(); }, [load]);
  if (loading && !contact) return <p className="empty" role="status">در حال دریافت ارتباط…</p>;
  if (!contact) return <><CrmBreadcrumb title="ارتباط پیدا نشد" /><p className="message error" role="alert">{error}</p><Link href="/platform/crm">بازگشت به سازمان‌ها</Link></>;
  return <><CrmBreadcrumb title={contact.name} />{error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success" role="status">{notice}</p>}
    {contact.archivedAt && <p className="message warning">این ارتباط بایگانی شده است؛ سوابق حفظ شده‌اند.</p>}
    {editing ? <ContactEditor key={`${contact.id}:${contact.updatedAt}`} api={api} organizationId={contact.organizationId} contactId={contact.id} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); setNotice("اطلاعات ارتباط ذخیره شد."); await load(); }} /> : <section className="detail crm-org-detail"><header><div><h1>{contact.name}</h1><p>{contact.role || "عنوان شغلی ثبت نشده"} · <Link href={`/platform/crm/organizations/${contact.organizationId}`}>{contact.organizationName}</Link></p></div>{canManage && !contact.archivedAt && <button type="button" onClick={() => setEditing(true)}>ویرایش ارتباط</button>}</header><dl className="crm-facts"><div><dt>شماره موبایل</dt><dd dir="ltr">{contact.phone || "ثبت نشده"}</dd></div><div><dt>ایمیل</dt><dd dir="ltr">{contact.email || "ثبت نشده"}</dd></div><div><dt>تاریخ ثبت</dt><dd>{formatDate(contact.createdAt)}</dd></div><div><dt>آخرین تغییر</dt><dd>{formatDate(contact.updatedAt)}</dd></div></dl></section>}
    <CrmWorkSections api={api} canManage={canManage && !contact.archivedAt} context={{ organizationId: contact.organizationId, contactId: contact.id, displayName: contact.name }} />
  </>;
}

function CrmBreadcrumb({ title }: { title: string }) { return <header className="crm-heading"><div><p className="platform-nav-label"><Link href="/platform/crm">سازمان‌ها</Link> / CRM</p><h1>{title}</h1></div></header>; }
function matchLabel(value: string) { return ({ name_city: "نام و شهر", website: "وب‌سایت", instagram: "اینستاگرام", phone: "شماره موبایل", email: "ایمیل" } as Record<string, string>)[value] ?? value; }
