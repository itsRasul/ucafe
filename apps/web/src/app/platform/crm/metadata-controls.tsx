"use client";

import { FormEvent, useEffect, useState } from "react";
import { PlatformApi as Api } from "../use-platform-session";

export type CrmEntityType = "ORGANIZATION" | "CONTACT" | "LEAD" | "DEAL";
export type FilterCondition = { field: string; operator: string; value?: unknown };
export type FilterDefinition = { version: 1; logic: "AND" | "OR"; conditions: FilterCondition[] };
export type FilterField = { key: string; label: string; dataType: "TEXT" | "LONG_TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "SELECT" | "MULTI_SELECT" | "URL"; operators: string[]; options: { value?: string; id?: string; label: string }[] };
export type CrmSort = { field: string; direction: "ASC" | "DESC" };
export type CrmSavedView = { id: string; name: string; entityType: CrmEntityType; visibility: "PRIVATE" | "SHARED"; filterDefinition: FilterDefinition; queryDefinition: Record<string, string>; sortDefinition: CrmSort | null; criteriaValid: boolean; criteriaError: string | null; canEdit: boolean };

const emptyFilter: FilterDefinition = { version: 1, logic: "AND", conditions: [] };
const operatorLabels: Record<string, string> = { equals: "برابر است با", notEquals: "برابر نیست با", contains: "شامل است", startsWith: "شروع می‌شود با", isEmpty: "خالی است", isNotEmpty: "خالی نیست", gt: "بزرگ‌تر از", gte: "حداقل", lt: "کوچک‌تر از", lte: "حداکثر", between: "بین", isTrue: "بله", isFalse: "خیر", is: "برابر است با", isNot: "برابر نیست با", in: "یکی از", containsAny: "شامل یکی از", containsAll: "شامل همه", containsNone: "شامل هیچ‌کدام نیست" };

export function isFilterReady(filter: FilterDefinition) {
  return filter.conditions.every((condition) => {
    if (["isEmpty", "isNotEmpty", "isTrue", "isFalse"].includes(condition.operator)) return true;
    if (condition.operator === "between") return Array.isArray(condition.value) && condition.value.length === 2 && condition.value.every((value) => String(value).trim() !== "");
    if (["in", "containsAny", "containsAll", "containsNone"].includes(condition.operator)) return Array.isArray(condition.value) && condition.value.length > 0 && condition.value.length <= 50 && condition.value.every((value) => String(value).trim() !== "");
    return condition.value !== undefined && condition.value !== null && String(condition.value).trim() !== "";
  });
}

export function CrmFilterBuilder({ api, entityType, value, onChange }: { api: Api; entityType: CrmEntityType; value: FilterDefinition; onChange: (filter: FilterDefinition) => void }) {
  const [fields, setFields] = useState<FilterField[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void api<FilterField[]>(`/platform/crm/filter-fields?entityType=${entityType}`).then((result) => { if (!cancelled) { setFields(result); setError(""); } }).catch((reason) => { if (!cancelled) setError((reason as Error).message); });
    return () => { cancelled = true; };
  }, [api, entityType]);
  const fieldFor = (key: string) => fields.find((field) => field.key === key);
  const update = (index: number, patch: Partial<FilterCondition>) => onChange({ ...value, conditions: value.conditions.map((condition, at) => at === index ? { ...condition, ...patch } : condition) });
  return <section className="crm-filter-builder" aria-labelledby="crm-filter-builder-title">
    <header><div><h2 id="crm-filter-builder-title">فیلترهای بیشتر</h2><p>شرط‌های فیلتر روی داده‌های سرور اجرا می‌شوند.</p></div><button type="button" className="crm-secondary" disabled={!fields.length} onClick={() => { const field = fields[0]!; const condition: FilterCondition = { field: field.key, operator: field.operators[0]! }; onChange({ ...value, conditions: [...value.conditions, condition] }); }}>افزودن شرط</button></header>
    {error && <p className="message error" role="alert">فیلترها بارگذاری نشدند: {error}</p>}
    {value.conditions.length === 0 ? <p className="crm-filter-empty">هنوز شرطی اضافه نشده است.</p> : <div className="crm-filter-rows">
      {value.conditions.map((condition, index) => {
        const field = fieldFor(condition.field);
        const options = (field?.options ?? []).map((option) => ({ value: option.value ?? option.id ?? "", label: option.label }));
        const noValue = ["isEmpty", "isNotEmpty", "isTrue", "isFalse"].includes(condition.operator);
        return <div className="crm-filter-row" key={`${index}:${condition.field}`}>
          {index > 0 && <span className="crm-filter-join">{value.logic === "AND" ? "و" : "یا"}</span>}
          <label>فیلد<select value={condition.field} onChange={(event) => { const next = fieldFor(event.target.value); if (next) update(index, { field: next.key, operator: next.operators[0]!, value: undefined }); }}>{fields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label>شرط<select value={condition.operator} disabled={!field} onChange={(event) => update(index, { operator: event.target.value, value: undefined })}>{(field?.operators ?? []).map((operator) => <option key={operator} value={operator}>{operatorLabels[operator] ?? operator}</option>)}</select></label>
          {!noValue && field && <ValueControl field={field} condition={condition} onChange={(next) => update(index, { value: next })} />}
          <button type="button" className="crm-filter-remove" aria-label={`حذف شرط ${field?.label ?? "فیلتر"}`} onClick={() => onChange({ ...value, conditions: value.conditions.filter((_, at) => at !== index) })}>حذف</button>
        </div>;
      })}
    </div>}
    {value.conditions.length > 0 && !isFilterReady(value) && <p className="crm-filter-incomplete" role="status">برای اعمال فیلتر، مقدار همه شرط‌ها را کامل کنید.</p>}
    {value.conditions.length > 1 && <label className="crm-filter-logic">ترکیب شرط‌ها<select value={value.logic} onChange={(event) => onChange({ ...value, logic: event.target.value as "AND" | "OR" })}><option value="AND">همه شرط‌ها (و)</option><option value="OR">حداقل یک شرط (یا)</option></select></label>}
    {value.conditions.length > 0 && <div className="crm-filter-chips" aria-label="شرط‌های فعال">{value.conditions.map((condition, index) => <button type="button" key={`${index}:${condition.field}`} onClick={() => onChange({ ...value, conditions: value.conditions.filter((_, at) => at !== index) })}>{fieldFor(condition.field)?.label ?? condition.field} · {operatorLabels[condition.operator] ?? condition.operator}<span aria-hidden="true"> ×</span></button>)}<button type="button" className="crm-filter-clear" onClick={() => onChange(emptyFilter)}>پاک‌کردن همه</button></div>}
  </section>;
}

export function CrmCriteriaSummary({ api, entityType, filter, fieldCatalog }: { api: Api; entityType: CrmEntityType; filter: FilterDefinition; fieldCatalog?: FilterField[] }) {
  const [loadedFields, setLoadedFields] = useState<FilterField[]>([]);
  useEffect(() => {
    if (fieldCatalog) return;
    let cancelled = false;
    void api<FilterField[]>(`/platform/crm/filter-fields?entityType=${entityType}`).then((result) => { if (!cancelled) setLoadedFields(result); }).catch(() => {});
    return () => { cancelled = true; };
  }, [api, entityType, fieldCatalog]);
  const fields = fieldCatalog ?? loadedFields;
  const describe = (condition: FilterCondition) => {
    const field = fields.find((item) => item.key === condition.field);
    const noValue = ["isEmpty", "isNotEmpty", "isTrue", "isFalse"].includes(condition.operator);
    const label = (value: unknown) => field?.options.find((option) => (option.value ?? option.id) === String(value))?.label ?? String(value);
    const value = Array.isArray(condition.value) ? condition.value.map(label).join("، ") : label(condition.value ?? "");
    return `${field?.label ?? condition.field} ${operatorLabels[condition.operator] ?? condition.operator}${noValue ? "" : ` ${value}`}`;
  };
  return <small className="crm-criteria-summary" dir="auto">{filter.conditions.length ? filter.conditions.map(describe).join(filter.logic === "AND" ? " و " : " یا ") : "بدون شرط"}</small>;
}

function ValueControl({ field, condition, onChange }: { field: FilterField; condition: FilterCondition; onChange: (value: unknown) => void }) {
  if (condition.operator === "between") {
    const values = Array.isArray(condition.value) ? condition.value : ["", ""];
    return <div className="crm-filter-range"><label>از<input type={field.dataType === "DATE" ? "date" : "number"} step={field.dataType === "NUMBER" ? "any" : undefined} value={String(values[0] ?? "")} onChange={(event) => onChange([event.target.value, values[1] ?? ""])} /></label><label>تا<input type={field.dataType === "DATE" ? "date" : "number"} step={field.dataType === "NUMBER" ? "any" : undefined} value={String(values[1] ?? "")} onChange={(event) => onChange([values[0] ?? "", event.target.value])} /></label></div>;
  }
  if (field.dataType === "BOOLEAN") return <span className="crm-filter-value-hint">مقدار در شرط مشخص شده است</span>;
  if (field.dataType === "SELECT" || field.dataType === "MULTI_SELECT") {
    const multi = field.dataType === "MULTI_SELECT" || ["in", "containsAny", "containsAll", "containsNone"].includes(condition.operator);
    const selected = Array.isArray(condition.value) ? condition.value.map(String) : condition.value ? [String(condition.value)] : [];
    return <label>{multi ? "مقادیر" : "مقدار"}{multi ? <select multiple size={Math.min(4, Math.max(2, field.options.length))} value={selected} onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <select value={String(condition.value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">انتخاب کنید</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}</label>;
  }
  const inputType = field.dataType === "DATE" ? "date" : field.dataType === "NUMBER" ? "number" : field.dataType === "URL" ? "url" : "text";
  return <label>مقدار<input type={inputType} step={inputType === "number" ? "any" : undefined} value={String(condition.value ?? "")} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function CrmSavedViews({ api, entityType, canManage, filter, queryDefinition, sort, onApply }: { api: Api; entityType: CrmEntityType; canManage: boolean; filter: FilterDefinition; queryDefinition: Record<string, string>; sort: CrmSort; onApply: (view: CrmSavedView) => void }) {
  const [views, setViews] = useState<CrmSavedView[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"PRIVATE" | "SHARED">("PRIVATE");
  const [saving, setSaving] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveMode, setSaveMode] = useState<"new" | "update">("new");
  const [error, setError] = useState("");
  const load = () => api<CrmSavedView[]>(`/platform/crm/saved-views?entityType=${entityType}`).then((nextViews) => {
    setViews(nextViews);
    const id = new URL(window.location.href).searchParams.get("savedView");
    const view = nextViews.find((item) => item.id === id);
    if (view) {
      setSelected(view.id); setName(view.name); setVisibility(view.visibility);
      if (view.criteriaValid) onApply(view);
      else setError(view.criteriaError || "این نما به فیلد غیرفعالی ارجاع می‌دهد.");
    }
  }).catch((reason) => setError((reason as Error).message));
  useEffect(() => { void load(); }, [api, entityType]);
  useEffect(() => {
    const restore = () => {
      const id = new URL(window.location.href).searchParams.get("savedView");
      const view = views.find((item) => item.id === id);
      if (view) {
        setSelected(view.id); setName(view.name); setVisibility(view.visibility);
        if (view.criteriaValid) onApply(view);
        else setError(view.criteriaError || "این نما به فیلد غیرفعالی ارجاع می‌دهد.");
      } else if (!id) setSelected("");
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [views, onApply]);
  function updateViewUrl(id: string) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("savedView", id);
    else url.searchParams.delete("savedView");
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  const current = views.find((view) => view.id === selected);
  function select(id: string) {
    updateViewUrl(id);
    setSelected(id); setError("");
    if (!id) { setName(""); return; }
    const view = views.find((item) => item.id === id);
    if (!view) return;
    setName(view.name); setVisibility(view.visibility);
    if (!view.criteriaValid) { setError(view.criteriaError || "این نما به فیلد غیرفعالی ارجاع می‌دهد."); return; }
    onApply(view);
  }
  async function save(event: FormEvent, update: boolean) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const body = { name, ...(update ? {} : { entityType }), visibility, filterDefinition: filter, queryDefinition, sortDefinition: sort };
      if (update && current) await api(`/platform/crm/saved-views/${current.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else {
        const created = await api<CrmSavedView>("/platform/crm/saved-views", { method: "POST", body: JSON.stringify(body) });
        setSelected(created.id); updateViewUrl(created.id);
      }
      setShowSave(false); setName(""); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  }
  async function archive() {
    if (!current) return;
    setSaving(true); setError("");
    try { await api(`/platform/crm/saved-views/${current.id}/archive`, { method: "POST" }); setSelected(""); await load(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  }
  return <section className="crm-saved-view-controls" aria-label="نماهای ذخیره‌شده">
    <label>نمای ذخیره‌شده<select value={selected} onChange={(event) => select(event.target.value)}><option value="">نمای فعلی</option>{views.map((view) => <option key={view.id} value={view.id}>{view.name}{view.visibility === "SHARED" ? " · مشترک" : " · شخصی"}{view.criteriaValid ? "" : " · نیازمند اصلاح"}</option>)}</select></label>
    {canManage && current?.canEdit && <button type="button" className="crm-secondary" onClick={() => { setSaveMode("update"); setShowSave((open) => !open); setError(""); }}>ذخیره تغییرات نما</button>}
    {canManage && <button type="button" onClick={() => { setSaveMode("new"); setName(""); setVisibility("PRIVATE"); setShowSave((open) => !open); setError(""); }}>ذخیره به‌عنوان نما</button>}
    {current?.canEdit && <button type="button" className="crm-danger" disabled={saving} onClick={() => void archive()}>بایگانی نما</button>}
    {showSave && canManage && <form className="crm-saved-view-form" onSubmit={(event) => void save(event, saveMode === "update")}>
      <label>نام نما<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>دسترسی<select value={visibility} onChange={(event) => setVisibility(event.target.value as "PRIVATE" | "SHARED")}><option value="PRIVATE">شخصی</option><option value="SHARED">مشترک با CRM</option></select></label>
      <button disabled={saving || !isFilterReady(filter) || (saveMode === "new" && !name.trim())}>{saving ? "در حال ذخیره…" : saveMode === "update" ? "ذخیره تغییرات" : "ذخیره نما"}</button><button type="button" className="crm-secondary" onClick={() => setShowSave(false)}>انصراف</button>
    </form>}
    {error && <p className="message error" role="alert">{error}</p>}
    {current && !current.criteriaValid && <p className="message warning" role="status">{current.criteriaError || "این نما شامل شرط غیرفعال است."}</p>}
  </section>;
}

export const initialFilter = (): FilterDefinition => ({ ...emptyFilter, conditions: [] });

type RecordMetadataField = { id: string; key: string; label: string; description: string | null; dataType: string; required: boolean; active: boolean; archivedAt: string | null; options: { id: string; label: string; active: boolean; archivedAt: string | null }[] };
type RecordTag = { id: string; name: string; color: string | null; active: boolean; archivedAt: string | null };

export function CrmRecordMetadata({ api, entityType, recordId, editable }: { api: Api; entityType: CrmEntityType; recordId: string; editable: boolean }) {
  const [fields, setFields] = useState<RecordMetadataField[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [savedValues, setSavedValues] = useState<Record<string, unknown>>({});
  const [tags, setTags] = useState<RecordTag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    try {
      const [fieldResult, recordTags, availableTags] = await Promise.all([
        api<{ fields: RecordMetadataField[]; values: Record<string, unknown> }>(`/platform/crm/records/${entityType}/${recordId}/custom-fields`),
        api<RecordTag[]>(`/platform/crm/records/${entityType}/${recordId}/tags`),
        api<RecordTag[]>("/platform/crm/tags"),
      ]);
      const allTags = new Map([...availableTags, ...recordTags].map((tag) => [tag.id, tag]));
      setFields(fieldResult.fields); setValues(fieldResult.values); setSavedValues(fieldResult.values); setTags([...allTags.values()]); setSelectedTags(recordTags.map((tag) => tag.id)); setError("");
    } catch (reason) { setError((reason as Error).message); }
  }
  useEffect(() => { void load(); }, [api, entityType, recordId]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const changedValues = Object.fromEntries(fields.filter((field) => field.active && !field.archivedAt).flatMap((field) => {
        const value = values[field.key];
        if (JSON.stringify(value ?? null) === JSON.stringify(savedValues[field.key] ?? null)) return [];
        return [[field.key, value === "" || value === undefined ? null : value]];
      }));
      if (Object.keys(changedValues).length) await api(`/platform/crm/records/${entityType}/${recordId}/custom-fields`, { method: "PATCH", body: JSON.stringify({ values: changedValues }) });
      await api(`/platform/crm/records/${entityType}/${recordId}/tags`, { method: "PUT", body: JSON.stringify({ tagIds: selectedTags }) });
      setEditing(false); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  const activeTags = tags.filter((tag) => tag.active && !tag.archivedAt);
  const matchingTags = activeTags.filter((tag) => tag.name.toLocaleLowerCase().includes(tagSearch.trim().toLocaleLowerCase()));
  const selected = tags.filter((tag) => selectedTags.includes(tag.id));
  const valueLabel = (field: RecordMetadataField, value: unknown) => {
    if (field.dataType === "BOOLEAN") return value === true ? "بله" : value === false ? "خیر" : "—";
    if (field.dataType === "SINGLE_SELECT") return field.options.find((option) => option.id === value)?.label ?? "—";
    if (field.dataType === "MULTI_SELECT" && Array.isArray(value)) return value.map((id) => field.options.find((option) => option.id === id)?.label ?? String(id)).join("، ") || "—";
    return value == null || value === "" ? "—" : String(value);
  };
  return <section className="crm-lead-panel crm-record-metadata"><header className="crm-section-heading"><div><h2>فیلدها و برچسب‌ها</h2><p>اطلاعات تکمیلی مستقل از مشخصات اصلی رکورد نگهداری می‌شود.</p></div>{editable && !editing && <button type="button" className="crm-secondary" onClick={() => setEditing(true)}>ویرایش</button>}</header>
    {error && <p className="message error" role="alert">{error}</p>}
    {editing && editable ? <form className="crm-meta-form" onSubmit={(event) => void save(event)}>
      {fields.filter((field) => field.active && !field.archivedAt).map((field) => <label key={field.id}>{field.label}{field.required && <small>الزامی هنگام ثبت مقدار</small>}{field.description && <small>{field.description}</small>}{renderRecordField(field, values[field.key], (value) => setValues((current) => ({ ...current, [field.key]: value })))}</label>)}
      <div className="crm-meta-tags"><strong>برچسب‌ها</strong>{activeTags.length ? <><label className="crm-meta-tag-search">جست‌وجوی برچسب<input type="search" value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} /></label>{matchingTags.length ? matchingTags.map((tag) => <label className="crm-meta-check" key={tag.id}><input type="checkbox" checked={selectedTags.includes(tag.id)} onChange={(event) => setSelectedTags((current) => event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id))} />{tag.name}</label>) : <small>برچسبی با این نام پیدا نشد.</small>}</> : <small>برچسب فعالی تعریف نشده است.</small>}{selected.filter((tag) => !tag.active || tag.archivedAt).map((tag) => <label className="crm-meta-check" key={tag.id}><input type="checkbox" checked={selectedTags.includes(tag.id)} onChange={(event) => setSelectedTags((current) => event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id))} />{tag.name} · بایگانی‌شده</label>)}</div>
      <div className="crm-form-actions"><button disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره فیلدها و برچسب‌ها"}</button><button type="button" className="crm-secondary" onClick={() => { setEditing(false); void load(); }}>انصراف</button></div>
    </form> : <>
      {fields.some((field) => values[field.key] !== undefined) && <dl className="crm-facts">{fields.filter((field) => values[field.key] !== undefined).map((field) => <div key={field.id}><dt>{field.label}</dt><dd>{valueLabel(field, values[field.key])}</dd></div>)}</dl>}
      {selected.length > 0 && <div className="crm-record-tag-list" aria-label="برچسب‌های رکورد">{selected.map((tag) => <span className={`crm-tag crm-tag-${tag.color ?? "gray"}`} key={tag.id}>{tag.name}</span>)}</div>}
      {!fields.some((field) => values[field.key] !== undefined) && selected.length === 0 && <p className="empty crm-empty">فیلد اختصاصی یا برچسبی برای این رکورد ثبت نشده است.</p>}
    </>}
  </section>;
}

function renderRecordField(field: RecordMetadataField, value: unknown, onChange: (value: unknown) => void) {
  const required = field.required && value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
  if (field.dataType === "LONG_TEXT") return <textarea required={required} maxLength={4000} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  if (field.dataType === "BOOLEAN") return <select required={required} value={value === true ? "true" : value === false ? "false" : ""} onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")}><option value="">انتخاب کنید</option><option value="true">بله</option><option value="false">خیر</option></select>;
  if (field.dataType === "SINGLE_SELECT") return <select required={required} value={String(value ?? "")} onChange={(event) => onChange(event.target.value || undefined)}><option value="">انتخاب کنید</option>{field.options.filter((option) => option.active && !option.archivedAt).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>;
  if (field.dataType === "MULTI_SELECT") return <select multiple required={required} size={Math.min(5, Math.max(2, field.options.length))} value={Array.isArray(value) ? value.map(String) : []} onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{field.options.filter((option) => option.active && !option.archivedAt).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>;
  const type = field.dataType === "NUMBER" ? "number" : field.dataType === "DATE" ? "date" : field.dataType === "URL" ? "url" : "text";
  return <input type={type} step={type === "number" ? "any" : undefined} required={required} maxLength={type === "number" || type === "date" ? undefined : 2048} value={String(value ?? "")} onChange={(event) => onChange(type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)} />;
}
