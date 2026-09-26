"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PlatformApi as Api, usePlatformSession } from "../use-platform-session";
import { CrmCriteriaSummary, CrmEntityType, CrmFilterBuilder, FilterDefinition, FilterField, initialFilter, isFilterReady } from "./metadata-controls";
import { CrmShell } from "./workspace";

type Entity = CrmEntityType;
type Field = { id: string; entityType: Entity; key: string; label: string; description: string | null; dataType: string; required: boolean; active: boolean; sortOrder: number; archivedAt: string | null; options: { id: string; label: string; active: boolean; archivedAt: string | null }[] };
type Tag = { id: string; name: string; description: string | null; color: string | null; active: boolean; archivedAt: string | null };
type Segment = { id: string; name: string; description: string | null; entityType: Entity; filterDefinition: FilterDefinition; criteriaValid?: boolean };
type Preview = { count: number; items: { id: string; name: string; subtitle: string }[] };
type SegmentPage = { items: Preview["items"]; total: number; page: number; pageSize: number };
const entities: { id: Entity; label: string }[] = [{ id: "ORGANIZATION", label: "سازمان" }, { id: "CONTACT", label: "فرد رابط" }, { id: "LEAD", label: "سرنخ" }, { id: "DEAL", label: "فرصت فروش" }];
const types = [{ id: "TEXT", label: "متن کوتاه" }, { id: "LONG_TEXT", label: "متن بلند" }, { id: "NUMBER", label: "عدد" }, { id: "BOOLEAN", label: "بله یا خیر" }, { id: "DATE", label: "تاریخ" }, { id: "SINGLE_SELECT", label: "انتخاب تکی" }, { id: "MULTI_SELECT", label: "انتخاب چندگانه" }, { id: "URL", label: "نشانی وب" }];
const colors = { gray: "خاکستری", blue: "آبی", green: "سبز", amber: "کهربایی", red: "قرمز", purple: "بنفش" };
const entityLabel = (entity: Entity) => entities.find((item) => item.id === entity)?.label ?? entity;

export function CrmMetadataPage({ mode }: { mode: "settings" | "segments" }) {
  const { state, access, api } = usePlatformSession();
  if (state === "loading") return <main className="platform-entry"><p>در حال بررسی دسترسی…</p></main>;
  if (state !== "ready" || !access.includes("crm.read")) return <main className="platform-entry"><section><h1>دسترسی CRM فعال نیست</h1><p>برای دیدن این بخش به دسترسی crm.read نیاز دارید.</p><Link className="crm-button" href="/platform">بازگشت به پنل پلتفرم</Link></section></main>;
  if (mode === "settings" && !access.includes("crm.manage")) return <main className="platform-entry"><section><h1>دسترسی مدیریت CRM فعال نیست</h1><p>برای مدیریت فیلدها و برچسب‌ها به crm.manage نیاز دارید.</p><Link className="crm-button" href="/platform/crm">بازگشت به CRM</Link></section></main>;
  return <CrmShell canManage={access.includes("crm.manage")}>{mode === "settings" ? <Settings api={api} /> : <Segments api={api} canManage={access.includes("crm.manage")} />}</CrmShell>;
}

export function CrmSegmentDetailPage({ segmentId }: { segmentId: string }) {
  const { state, access, api } = usePlatformSession();
  if (state === "loading") return <main className="platform-entry"><p>در حال بررسی دسترسی…</p></main>;
  if (state !== "ready" || !access.includes("crm.read")) return <main className="platform-entry"><section><h1>دسترسی CRM فعال نیست</h1><Link className="crm-button" href="/platform">بازگشت به پنل پلتفرم</Link></section></main>;
  return <CrmShell canManage={access.includes("crm.manage")}><SegmentDetail api={api} segmentId={segmentId} canManage={access.includes("crm.manage")} /></CrmShell>;
}

function SegmentDetail({ api, segmentId, canManage }: { api: Api; segmentId: string; canManage: boolean }) {
  const [segment, setSegment] = useState<Segment | null>(null);
  const [records, setRecords] = useState<SegmentPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  async function load(page: number) {
    if (!segment?.criteriaValid) return;
    setBusy(true); setError("");
    try { setRecords(await api<SegmentPage>(`/platform/crm/segments/${segmentId}/records?page=${page}&pageSize=20`)); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let cancelled = false;
    void api<Segment>(`/platform/crm/segments/${segmentId}`).then(async (result) => {
      if (cancelled) return;
      setSegment(result);
      if (!result.criteriaValid) { setError("معیارها به فیلد یا گزینه‌ای غیرفعال ارجاع می‌دهند؛ ابتدا آن‌ها را اصلاح کنید."); return; }
      const page = await api<SegmentPage>(`/platform/crm/segments/${segmentId}/records?page=1&pageSize=20`);
      if (!cancelled) setRecords(page);
    }).catch((reason) => { if (!cancelled) setError((reason as Error).message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, segmentId]);
  const route = segment ? ({ ORGANIZATION: "organizations", CONTACT: "contacts", LEAD: "leads", DEAL: "deals" } as Record<Entity, string>)[segment.entityType] : "";
  return <>
    <header className="crm-section-heading"><div><p className="platform-nav-label">پلتفرم / CRM</p><h1>{segment?.name ?? "جزئیات بخش‌بندی"}</h1><p>{segment?.description || "اعضا از داده‌های جاری محاسبه می‌شوند."}</p></div><div className="crm-actions"><Link className="crm-button crm-secondary-link" href="/platform/crm/segments">بازگشت به بخش‌بندی‌ها</Link>{segment && canManage && <Link className="crm-button" href={`/platform/crm/segments?edit=${segment.id}`}>ویرایش معیارها</Link>}</div></header>
    {error && <p className="message error" role="alert">{error}</p>}
    {segment && <section className="crm-lead-panel"><header className="crm-section-heading"><div><h2>معیارهای عضویت</h2><p>تعداد و اعضا در هر بار مشاهده از داده‌های جاری محاسبه می‌شوند.</p></div>{records && <strong>{new Intl.NumberFormat("fa-IR").format(records.total)} {entityLabel(segment.entityType)}</strong>}</header><CrmCriteriaSummary api={api} entityType={segment.entityType} filter={segment.filterDefinition} />
      {loading ? <p className="empty">در حال دریافت اعضا…</p> : records && records.items.length ? <ul className="crm-meta-list">{records.items.map((item) => <li key={item.id}><div><Link href={`/platform/crm/${route}/${item.id}`}>{item.name}</Link><small>{item.subtitle}</small></div></li>)}</ul> : !error && <p className="empty crm-empty">این بخش‌بندی رکوردی ندارد.</p>}
      {records && records.total > records.pageSize && <div className="crm-form-actions"><button type="button" className="crm-secondary" disabled={busy || records.page <= 1} onClick={() => void load(records.page - 1)}>قبلی</button><span>صفحه {new Intl.NumberFormat("fa-IR").format(records.page)} از {new Intl.NumberFormat("fa-IR").format(Math.ceil(records.total / records.pageSize))}</span><button type="button" className="crm-secondary" disabled={busy || records.page * records.pageSize >= records.total} onClick={() => void load(records.page + 1)}>بعدی</button></div>}
    </section>}
  </>;
}

function Settings({ api }: { api: Api }) {
  const [entityType, setEntityType] = useState<Entity>("ORGANIZATION");
  const [fields, setFields] = useState<Field[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("blue");
  const [fieldForm, setFieldForm] = useState({ key: "", label: "", dataType: "TEXT", description: "", required: false, sortOrder: "0", options: "" });
  const [saving, setSaving] = useState(false);
  async function load() {
    try {
      const [nextFields, nextTags] = await Promise.all([
        api<Field[]>(`/platform/crm/custom-fields?entityType=${entityType}&includeInactive=true`),
        api<Tag[]>("/platform/crm/tags?includeArchived=true"),
      ]);
      setFields(nextFields); setTags(nextTags); setError("");
    } catch (reason) { setError((reason as Error).message); }
  }
  useEffect(() => { void load(); }, [api, entityType]);
  async function createField(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await api("/platform/crm/custom-fields", { method: "POST", body: JSON.stringify({ entityType, ...fieldForm, sortOrder: Number(fieldForm.sortOrder), description: fieldForm.description || null, options: ["SINGLE_SELECT", "MULTI_SELECT"].includes(fieldForm.dataType) ? fieldForm.options.split("\n").map((label) => label.trim()).filter(Boolean).map((label) => ({ label })) : [] }) });
      setFieldForm({ key: "", label: "", dataType: "TEXT", description: "", required: false, sortOrder: "0", options: "" }); await load();
    } catch (reason) { setError((reason as Error).message); } finally { setSaving(false); }
  }
  async function createTag(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await api("/platform/crm/tags", { method: "POST", body: JSON.stringify({ name, description: description || null, color }) }); setName(""); setDescription(""); await load(); }
    catch (reason) { setError((reason as Error).message); } finally { setSaving(false); }
  }
  async function archive(url: string) { setSaving(true); setError(""); try { await api(url, { method: "POST" }); await load(); } catch (reason) { setError((reason as Error).message); } finally { setSaving(false); } }
  async function updateField(field: Field, patch: Record<string, unknown>) { setSaving(true); setError(""); try { await api(`/platform/crm/custom-fields/${field.id}`, { method: "PATCH", body: JSON.stringify(patch) }); await load(); } catch (reason) { setError((reason as Error).message); } finally { setSaving(false); } }
  async function changeOptions(field: Field, change: { id?: string; label: string; active: boolean; archivedAt: string | null }) {
    const options = change.id ? field.options.map((option) => option.id === change.id ? { ...option, label: change.label, active: change.active } : option) : [...field.options, { ...change, id: "" }];
    setSaving(true); setError("");
    try { await api(`/platform/crm/custom-fields/${field.id}`, { method: "PATCH", body: JSON.stringify({ options: options.map(({ id, label, active }) => ({ ...(id ? { id } : {}), label, active })) }) }); await load(); }
    catch (reason) { setError((reason as Error).message); } finally { setSaving(false); }
  }
  async function addOption(field: Field) { const label = window.prompt("عنوان گزینه جدید:")?.trim(); if (label) await changeOptions(field, { label, active: true, archivedAt: null }); }
  async function editField(field: Field) {
    const label = window.prompt("عنوان فیلد:", field.label)?.trim();
    if (!label || label === field.label) return;
    await updateField(field, { label });
  }
  async function editTag(tag: Tag) {
    const next = window.prompt("نام برچسب:", tag.name)?.trim();
    if (!next || next === tag.name) return;
    setSaving(true); setError("");
    try { await api(`/platform/crm/tags/${tag.id}`, { method: "PATCH", body: JSON.stringify({ name: next }) }); await load(); }
    catch (reason) { setError((reason as Error).message); } finally { setSaving(false); }
  }
  return <>
    <header className="crm-section-heading"><div><p className="platform-nav-label">پلتفرم / CRM</p><h1>فیلدها و برچسب‌ها</h1><p>فیلدهای افزوده و برچسب‌های مشترک CRM را مدیریت کنید.</p></div><Link className="crm-button crm-secondary-link" href="/platform/crm/segments">بخش‌بندی‌ها</Link></header>
    {error && <p className="message error" role="alert">{error}</p>}
    <section className="crm-lead-panel"><header className="crm-section-heading"><div><h2>فیلدهای اختصاصی</h2><p>نوع فیلد پس از ساخت ثابت می‌ماند؛ گزینه‌های انتخاب شناسه پایدار دارند.</p></div><label>نوع رکورد<select value={entityType} onChange={(event) => setEntityType(event.target.value as Entity)}>{entities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></header>
      <form className="form crm-form crm-meta-form" onSubmit={(event) => void createField(event)}>
        <label>کلید فنی<input required pattern="[a-z][a-z0-9_]{0,63}" maxLength={64} value={fieldForm.key} onChange={(event) => setFieldForm({ ...fieldForm, key: event.target.value })} /><small>پس از ساخت تغییر نمی‌کند.</small></label>
        <label>عنوان فیلد<input required maxLength={120} value={fieldForm.label} onChange={(event) => setFieldForm({ ...fieldForm, label: event.target.value })} /></label>
        <label>نوع فیلد<select value={fieldForm.dataType} onChange={(event) => setFieldForm({ ...fieldForm, dataType: event.target.value })}>{types.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>ترتیب نمایش<input type="number" min={0} max={10000} step={1} value={fieldForm.sortOrder} onChange={(event) => setFieldForm({ ...fieldForm, sortOrder: event.target.value })} /></label>
        <label>توضیح<input maxLength={500} value={fieldForm.description} onChange={(event) => setFieldForm({ ...fieldForm, description: event.target.value })} /></label>
        {["SINGLE_SELECT", "MULTI_SELECT"].includes(fieldForm.dataType) && <label className="crm-meta-wide">گزینه‌ها (هر گزینه در یک خط)<textarea required value={fieldForm.options} onChange={(event) => setFieldForm({ ...fieldForm, options: event.target.value })} /></label>}
        <label className="crm-meta-check"><input type="checkbox" checked={fieldForm.required} onChange={(event) => setFieldForm({ ...fieldForm, required: event.target.checked })} /> مقدار این فیلد الزامی است</label>
        <div className="crm-form-actions"><button disabled={saving}>{saving ? "در حال ذخیره…" : "افزودن فیلد"}</button></div>
      </form>
      {fields.length ? <ul className="crm-meta-list">{fields.map((field) => <li key={field.id}><div><strong>{field.label}</strong><small><code dir="ltr">{field.key}</code> · {types.find((type) => type.id === field.dataType)?.label ?? field.dataType}{field.required ? " · الزامی" : ""}{field.archivedAt ? " · بایگانی‌شده" : !field.active ? " · غیرفعال" : ""}</small>{field.description && <p>{field.description}</p>}<form className="crm-field-order" onSubmit={(event) => { event.preventDefault(); const sortOrder = Number(new FormData(event.currentTarget).get("sortOrder")); if (Number.isInteger(sortOrder) && sortOrder >= 0 && sortOrder <= 10000) void updateField(field, { sortOrder }); }}><label>ترتیب نمایش<input name="sortOrder" type="number" required min={0} max={10000} step={1} defaultValue={field.sortOrder} /></label><button type="submit" className="crm-secondary" disabled={saving || Boolean(field.archivedAt)}>ذخیره ترتیب</button></form>
          {field.options.length > 0 && <div className="crm-meta-options">{field.options.map((option) => <span key={option.id}>{option.label}{option.archivedAt || !option.active ? " (غیرفعال)" : ""}<button type="button" aria-label={`ویرایش گزینه ${option.label}`} disabled={saving || Boolean(option.archivedAt) || Boolean(field.archivedAt)} onClick={() => { const label = window.prompt("عنوان گزینه:", option.label)?.trim(); if (label && label !== option.label) void changeOptions(field, { ...option, label }); }}>{"✎"}</button>{!option.archivedAt && <button type="button" aria-label={`${option.active ? "بایگانی" : "فعال‌کردن"} گزینه ${option.label}`} disabled={saving || Boolean(field.archivedAt)} onClick={() => void changeOptions(field, { ...option, active: !option.active })}>{option.active ? "×" : "↻"}</button>}</span>)}<button type="button" className="crm-secondary" disabled={saving || Boolean(field.archivedAt)} onClick={() => void addOption(field)}>افزودن گزینه</button></div>}</div>
          <div className="crm-actions">{!field.archivedAt && <><button type="button" className="crm-secondary" disabled={saving} onClick={() => void editField(field)}>ویرایش عنوان</button><button type="button" className="crm-secondary" disabled={saving} onClick={() => void updateField(field, { active: !field.active })}>{field.active ? "غیرفعال‌کردن" : "فعال‌کردن"}</button><button type="button" className="crm-danger" disabled={saving} onClick={() => void archive(`/platform/crm/custom-fields/${field.id}/archive`)}>بایگانی</button></>}</div></li>)}</ul> : <p className="empty crm-empty">برای این نوع رکورد هنوز فیلدی تعریف نشده است.</p>}
    </section>
    <section className="crm-lead-panel"><header className="crm-section-heading"><div><h2>برچسب‌های CRM</h2><p>برچسب بایگانی‌شده حذف نمی‌شود و از انتخاب‌های جدید کنار می‌رود.</p></div></header>
      <form className="form crm-form crm-meta-form" onSubmit={(event) => void createTag(event)}><label>نام برچسب<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label><label>توضیح<input maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>رنگ<select value={color} onChange={(event) => setColor(event.target.value)}>{Object.entries(colors).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="crm-form-actions"><button disabled={saving}>افزودن برچسب</button></div></form>
      <ul className="crm-meta-list">{tags.map((tag) => <li key={tag.id}><div><strong className={`crm-tag crm-tag-${tag.color ?? "gray"}`}>{tag.name}</strong>{tag.description && <p>{tag.description}</p>}{(tag.archivedAt || !tag.active) && <small>بایگانی‌شده</small>}</div>{!tag.archivedAt && <div className="crm-actions"><button type="button" className="crm-secondary" disabled={saving} onClick={() => void editTag(tag)}>تغییر نام</button><button type="button" className="crm-danger" disabled={saving} onClick={() => void archive(`/platform/crm/tags/${tag.id}/archive`)}>بایگانی</button></div>}</li>)}</ul>
    </section>
  </>;
}

function Segments({ api, canManage }: { api: Api; canManage: boolean }) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [summaryFields, setSummaryFields] = useState<Record<Entity, FilterField[]>>({ ORGANIZATION: [], CONTACT: [], LEAD: [], DEAL: [] });
  const [entityType, setEntityType] = useState<Entity>("ORGANIZATION");
  const [filter, setFilter] = useState<FilterDefinition>(initialFilter());
  const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [selected, setSelected] = useState(""); const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const nextSegments = await api<Segment[]>("/platform/crm/segments");
      setSegments(nextSegments);
      const entityTypes = [...new Set(nextSegments.map((segment) => segment.entityType))];
      const catalogs = await Promise.all(entityTypes.map(async (type) => [type, await api<FilterField[]>(`/platform/crm/filter-fields?entityType=${type}`)] as const));
      setSummaryFields((current) => ({ ...current, ...Object.fromEntries(catalogs) }));
    } catch (reason) { setError((reason as Error).message); }
  }
  useEffect(() => {
    void load();
    const editId = new URLSearchParams(window.location.search).get("edit");
    if (editId) void api<Segment>(`/platform/crm/segments/${editId}`).then(edit).catch((reason) => setError((reason as Error).message));
  }, [api]);
  async function previewCurrent() { setBusy(true); setError(""); setPreview(null); try { setPreview(await api<Preview>("/platform/crm/segments/preview", { method: "POST", body: JSON.stringify({ entityType, filterDefinition: filter }) })); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  function edit(segment: Segment) { setSelected(segment.id); setName(segment.name); setDescription(segment.description ?? ""); setEntityType(segment.entityType); setFilter(segment.filterDefinition); setPreview(null); setError(""); }
  function reset() { setSelected(""); setName(""); setDescription(""); setEntityType("ORGANIZATION"); setFilter(initialFilter()); setPreview(null); }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = JSON.stringify({ name, description: description || null, entityType, filterDefinition: filter });
      if (selected) await api(`/platform/crm/segments/${selected}`, { method: "PATCH", body });
      else await api("/platform/crm/segments", { method: "POST", body });
      await load(); reset();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function archive(id: string) { setBusy(true); setError(""); try { await api(`/platform/crm/segments/${id}/archive`, { method: "POST" }); if (selected === id) reset(); await load(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  const href = (item: Preview["items"][number]) => `/platform/crm/${({ ORGANIZATION: "organizations", CONTACT: "contacts", LEAD: "leads", DEAL: "deals" } as Record<Entity, string>)[entityType]}/${item.id}`;
  return <>
    <header className="crm-section-heading"><div><p className="platform-nav-label">پلتفرم / CRM</p><h1>بخش‌بندی پویای رکوردها</h1><p>شرط‌ها هر بار روی رکوردهای فعلی اجرا می‌شوند؛ اعضا به‌صورت ثابت ذخیره نمی‌شوند.</p></div><Link className="crm-button crm-secondary-link" href="/platform/crm/settings">فیلدها و برچسب‌ها</Link></header>
    {error && <p className="message error" role="alert">{error}</p>}
    <section className="crm-lead-panel"><header className="crm-section-heading"><div><h2>{selected ? "ویرایش بخش‌بندی" : "بخش‌بندی جدید"}</h2><p>حداکثر ۲۰ شرط ساده با ترکیب «و» یا «یا» پشتیبانی می‌شود.</p></div></header>
      <form className="crm-segment-form" onSubmit={(event) => void save(event)}>
        <div className="crm-meta-form"><label>نام بخش‌بندی<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label>نوع رکورد<select disabled={Boolean(selected)} value={entityType} onChange={(event) => { setEntityType(event.target.value as Entity); setFilter(initialFilter()); setPreview(null); }}>{entities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="crm-meta-wide">توضیح<input maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></label></div>
        <CrmFilterBuilder api={api} entityType={entityType} value={filter} onChange={(value) => { setFilter(value); setPreview(null); }} />
        <div className="crm-form-actions"><button type="button" className="crm-secondary" disabled={busy || !isFilterReady(filter)} onClick={() => void previewCurrent()}>{busy ? "در حال محاسبه…" : "پیش‌نمایش تعداد و نمونه"}</button>{canManage && <button disabled={busy || !name.trim() || !isFilterReady(filter)}>{selected ? "ذخیره تغییرات" : "ذخیره بخش‌بندی"}</button>}{selected && <button type="button" className="crm-secondary" onClick={reset}>بخش‌بندی جدید</button>}</div>
      </form>
      {preview && <div className="crm-segment-preview"><h3>نتیجه زنده: {new Intl.NumberFormat("fa-IR").format(preview.count)} {entityLabel(entityType)}</h3>{preview.items.length ? <ul className="crm-meta-list">{preview.items.map((item) => <li key={item.id}><Link href={href(item)}>{item.name}</Link><small>{item.subtitle}</small></li>)}</ul> : <p className="empty crm-empty">رکورد منطبق پیدا نشد.</p>}</div>}
    </section>
    <section className="crm-lead-panel"><header className="crm-section-heading"><div><h2>بخش‌بندی‌های ذخیره‌شده</h2><p>معیارها ذخیره می‌شوند و اعضا همیشه دوباره محاسبه می‌شوند.</p></div></header>{segments.length ? <ul className="crm-meta-list">{segments.map((segment) => <li key={segment.id}><div><Link href={`/platform/crm/segments/${segment.id}`}>{segment.name}</Link><small>{entityLabel(segment.entityType)} · {segment.description || `${segment.filterDefinition.conditions.length} شرط`}</small>{segment.criteriaValid === false ? <small className="crm-filter-incomplete">معیار نیازمند اصلاح است.</small> : <CrmCriteriaSummary api={api} entityType={segment.entityType} filter={segment.filterDefinition} fieldCatalog={summaryFields[segment.entityType]} />}</div><div className="crm-actions"><Link className="crm-button crm-secondary-link" href={`/platform/crm/segments/${segment.id}`}>مشاهده اعضا</Link>{canManage && <button type="button" className="crm-secondary" onClick={() => edit(segment)}>ویرایش معیارها</button>}{canManage && <button type="button" className="crm-danger" disabled={busy} onClick={() => void archive(segment.id)}>بایگانی</button>}</div></li>)}</ul> : <p className="empty crm-empty">هنوز بخش‌بندی ذخیره نشده است.</p>}</section>
  </>;
}
