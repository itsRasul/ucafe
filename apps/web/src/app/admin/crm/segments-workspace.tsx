"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { TenantPermission, useAdminSession } from "../admin-session";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Operator = string;
type Option = { value: string; label: string };
type FilterField = { key: string; label: string; dataType: string; source: string; operators: Operator[]; options: Option[] };
type Condition = { type: "condition"; field: string; operator: Operator; value?: unknown };
type Group = { type: "group"; version?: number; operator: "AND" | "OR"; conditions: Array<Group | Condition> };
type Segment = { id: string; name: string; description: string | null; criteria: Group; isActive: boolean; criteriaValid: boolean; criteriaIssue?: string };
type SmartGroup = { key: string; name: string; description: string; criteria: Group };
type Client = { id: string; firstName: string; lastName: string; phone: string; status: string; createdAt: string };
type ClientPage = { items: Client[]; total: number; page: number; pageSize: number };
type Preview = { matchingClients: number; sample: Client[] };
type Builder = { id?: string; name: string; description: string; criteria: Group };
type ViewState = { key: string; kind: "segment" | "smart"; preview: Preview; clients: ClientPage };

const number = new Intl.NumberFormat("fa-IR");
const date = (value: string) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(value));
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const sourceLabels: Record<string, string> = { client: "مشتری", crm: "ترجیحات CRM", tags: "برچسب‌ها", orders: "سفارش‌ها", reservations: "رزروها", custom: "فیلدهای اختصاصی" };
const operatorLabels: Record<string, string> = {
  equals: "برابر باشد با", contains: "شامل باشد", starts_with: "شروع شود با", is_empty: "خالی باشد", is_not_empty: "خالی نباشد",
  greater_than: "بزرگ‌تر از", greater_or_equal: "بزرگ‌تر یا برابر", less_than: "کوچک‌تر از", less_or_equal: "کوچک‌تر یا برابر",
  between: "بین این دو مقدار", before: "پیش از تاریخ", after: "پس از تاریخ", within_last: "در روزهای اخیر", older_than: "قدیمی‌تر از",
  this_month: "در ماه جاری", is_true: "بله", is_false: "خیر", in: "یکی از موارد", not_in: "هیچ‌یک از موارد",
  has_tag: "دارای برچسب", does_not_have_tag: "بدون برچسب", contains_any: "دارای یکی از موارد", contains_all: "دارای همه موارد",
  contains_none: "فاقد همه موارد",
};

function blankFor(field: FilterField, operator: string): unknown {
  if (["is_empty", "is_not_empty", "is_true", "is_false", "this_month"].includes(operator)) return undefined;
  if (operator === "between") return field.dataType === "NUMBER" ? [0, 0] : ["", ""];
  if (operator === "within_last" || operator === "older_than") return 30;
  if (operator === "in" || operator === "not_in" || operator.startsWith("contains_")) return [];
  if (field.dataType === "NUMBER") return 0;
  if (field.dataType === "TAG" || field.dataType === "ENUM") return field.options[0]?.value ?? "";
  return "";
}

function defaultOperator(field: FilterField): string {
  if (!field.options.length && field.operators.includes("is_empty")) return "is_empty";
  return field.operators[0] ?? "equals";
}

function newCondition(fields: FilterField[]): Condition {
  const field = fields[0];
  const operator = field ? defaultOperator(field) : "equals";
  return { type: "condition", field: field?.key ?? "", operator, ...(field ? { value: blankFor(field, operator) } : {}) };
}

function newGroup(fields: FilterField[], root = false): Group {
  return { type: "group", ...(root ? { version: 1 } : {}), operator: "AND", conditions: [newCondition(fields)] };
}

function conditionCount(group: Group): number {
  return group.conditions.reduce((count, node) => count + (node.type === "group" ? conditionCount(node) : 1), 0);
}

function setNode(root: Group, path: number[], change: (node: Group | Condition) => Group | Condition): Group {
  if (!path.length) return change(root) as Group;
  const [index, ...rest] = path;
  const conditions = [...root.conditions];
  const child = conditions[index!];
  if (!child) return root;
  conditions[index!] = rest.length ? setNode(child as Group, rest, change) : change(child);
  return { ...root, conditions };
}

function updateCondition(root: Group, path: number[], condition: Condition): Group {
  return setNode(root, path, () => condition);
}

function removeNode(root: Group, path: number[]): Group {
  if (path.length === 1) return { ...root, conditions: root.conditions.filter((_node, index) => index !== path[0]) };
  const [index, ...rest] = path;
  const conditions = [...root.conditions];
  const child = conditions[index!] as Group | undefined;
  if (child) conditions[index!] = removeNode(child, rest);
  return { ...root, conditions };
}

function updateGroup(root: Group, path: number[], group: Group): Group {
  return setNode(root, path, () => group);
}

function ValueEditor({ field, condition, onChange }: { field: FilterField; condition: Condition; onChange: (value: unknown) => void }) {
  const op = condition.operator;
  if (["is_empty", "is_not_empty", "is_true", "is_false", "this_month"].includes(op)) return null;
  if (op === "between") {
    const values = Array.isArray(condition.value) ? condition.value : ["", ""];
    const type = field.dataType === "NUMBER" ? "number" : "date";
    const input = (index: number) => <input aria-label={index === 0 ? "حد پایین بازه" : "حد بالای بازه"} type={type}
      step={type === "number" ? "any" : undefined} value={String(values[index] ?? "")}
      onChange={(event) => { const next = [...values]; next[index] = type === "number" ? Number(event.target.value) : event.target.value; onChange(next); }} />;
    return <span className="tenant-crm-segment-range">{input(0)}<span>تا</span>{input(1)}</span>;
  }
  if (op === "within_last" || op === "older_than") return <span className="tenant-crm-segment-relative"><input aria-label="تعداد روز" type="number" min="1" max="3650"
    value={Number(condition.value ?? 30)} onChange={(event) => onChange(Number(event.target.value))} /><span>روز</span></span>;
  if ((op === "in" || op === "not_in" || op.startsWith("contains_")) && field.options.length) {
    const selected = Array.isArray(condition.value) ? condition.value.map(String) : [];
    return <select aria-label="مقدار شرط" multiple size={Math.min(4, Math.max(2, field.options.length))}
      value={selected} onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>
      {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
  }
  if ((field.dataType === "ENUM" || field.dataType === "TAG" || field.dataType === "MULTI_SELECT") && !field.options.length)
    return <span className="tenant-crm-inline-error">گزینه فعالی برای این فیلد ثبت نشده است.</span>;
  if (field.dataType === "ENUM" || field.dataType === "TAG") return <select aria-label="مقدار شرط" value={String(condition.value ?? "")}
    onChange={(event) => onChange(event.target.value)}><option value="">انتخاب کنید</option>{field.options.map((option) =>
      <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  if (field.dataType === "DATE") return <input aria-label="تاریخ شرط" type="date" value={String(condition.value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  if (field.dataType === "NUMBER") return <input aria-label="مقدار شرط" type="number" step="any" value={String(condition.value ?? 0)}
    onChange={(event) => onChange(Number(event.target.value))} />;
  return <input aria-label="مقدار شرط" type="text" maxLength={500} value={String(condition.value ?? "")} onChange={(event) => onChange(event.target.value)} />;
}

function CriteriaEditor({ fields, criteria, onChange, disabled = false }: { fields: FilterField[]; criteria: Group; onChange: (value: Group) => void; disabled?: boolean }) {
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const canAddCondition = conditionCount(criteria) < 20;
  const render = (node: Group | Condition, path: number[], depth: number) => {
    if (node.type === "group") return <fieldset className="tenant-crm-criteria-group" key={path.join(".") || "root"}>
      <legend>{depth === 0 ? "ترکیب شرط‌ها" : "گروه شرط‌ها"}</legend>
      <label className="tenant-crm-control">تطبیق<select disabled={disabled} value={node.operator} onChange={(event) =>
        onChange(updateGroup(criteria, path, { ...node, operator: event.target.value as Group["operator"] }))}>
        <option value="AND">همه شرط‌ها (و)</option><option value="OR">هرکدام از شرط‌ها (یا)</option>
      </select></label>
      <div className="tenant-crm-criteria-children">{node.conditions.map((child, index) => render(child, [...path, index], depth + 1))}</div>
      {!disabled && <div className="tenant-crm-criteria-actions">
        <button type="button" disabled={!canAddCondition || node.conditions.length >= 20} onClick={() => onChange(updateGroup(criteria, path, { ...node, conditions: [...node.conditions, newCondition(fields)] }))}>افزودن شرط</button>
        {depth < 2 && <button type="button" disabled={!canAddCondition || node.conditions.length >= 20}
          onClick={() => onChange(updateGroup(criteria, path, { ...node, conditions: [...node.conditions, newGroup(fields)] }))}>افزودن گروه</button>}
      </div>}
    </fieldset>;
    const field = fieldByKey.get(node.field);
    const update = (next: Condition) => onChange(updateCondition(criteria, path, next));
    return <div className="tenant-crm-criteria-rule" key={path.join(".")}>
      <label className="tenant-crm-control">فیلد<select disabled={disabled} value={node.field} onChange={(event) => {
        const nextField = fieldByKey.get(event.target.value);
        if (!nextField) return;
        const operator = defaultOperator(nextField);
        update({ type: "condition", field: nextField.key, operator, ...(blankFor(nextField, operator) === undefined ? {} : { value: blankFor(nextField, operator) }) });
      }}>
        {!field && <option value={node.field}>فیلد در دسترس نیست · {node.field}</option>}
        {fields.map((item) => <option key={item.key} value={item.key}>{sourceLabels[item.source] ?? item.source} · {item.label}</option>)}
      </select></label>
      <label className="tenant-crm-control">شرط<select disabled={disabled || !field} value={node.operator} onChange={(event) => {
        const operator = event.target.value;
        update({ ...node, operator, ...(blankFor(field!, operator) === undefined ? { value: undefined } : { value: blankFor(field!, operator) }) });
      }}>
        {(field?.operators ?? [node.operator]).map((operator) => <option key={operator} value={operator}>{operatorLabels[operator] ?? operator}</option>)}
      </select></label>
      <label className="tenant-crm-control tenant-crm-condition-value">مقدار{field && <ValueEditor field={field} condition={node} onChange={(value) => update({ ...node, value })} />}</label>
      {!disabled && <button type="button" className="tenant-crm-remove-rule" disabled={path.length === 0 || (path.length > 0 && (getGroupAt(criteria, path.slice(0, -1))?.conditions.length ?? 1) < 2)}
        onClick={() => onChange(removeNode(criteria, path))}>حذف شرط</button>}
    </div>;
  };
  return <div className="tenant-crm-criteria">{render(criteria, [], 0)}</div>;
}

function getGroupAt(root: Group, path: number[]): Group | null {
  let node: Group | Condition = root;
  for (const index of path) {
    if (node.type !== "group") return null;
    const child: Group | Condition | undefined = node.conditions[index];
    if (!child) return null;
    node = child;
  }
  return node.type === "group" ? node : null;
}

export function TenantCrmSegmentsWorkspace({ mode }: { mode: "segments" | "smart" }) {
  const { access, api } = useAdminSession();
  const [fields, setFields] = useState<FilterField[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [groups, setGroups] = useState<SmartGroup[]>([]);
  const [builder, setBuilder] = useState<Builder | null>(null);
  const [builderPreview, setBuilderPreview] = useState<Preview | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [segmentPage, setSegmentPage] = useState(1);
  const [segmentTotal, setSegmentTotal] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canRead = access.permissions.includes("tenant_crm.read" as TenantPermission);
  const canManage = access.permissions.includes("tenant_crm.manage" as TenantPermission);
  const entitled = access.features?.tenant_crm === true;

  useEffect(() => {
    if (!canRead || !entitled) return;
    let active = true;
    const load = async () => {
      setLoading(true); setError("");
      try {
        const catalog = await api<FilterField[]>("/tenant/crm/segments/fields");
        if (active) setFields(catalog);
        if (mode === "smart") {
          const presets = await api<SmartGroup[]>("/tenant/crm/smart-groups");
          if (active) setGroups(presets);
        } else {
          const params = new URLSearchParams({ page: String(segmentPage), pageSize: "25" });
          const page = await api<{ items: Segment[]; total: number }>(`/tenant/crm/segments?${params}`);
          if (active) { setSegments(page.items); setSegmentTotal(page.total); }
          const key = new URLSearchParams(window.location.search).get("smartGroup");
          if (key) {
            const presets = await api<SmartGroup[]>("/tenant/crm/smart-groups");
            const preset = presets.find((item) => item.key === key);
            if (active && preset) setBuilder({ name: preset.name, description: preset.description, criteria: preset.criteria });
            window.history.replaceState({}, "", "/admin/crm/segments");
          }
        }
      } catch (reason) { if (active) setError((reason as Error).message); }
      finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [api, canRead, entitled, mode, refresh, segmentPage]);

  const openView = async (key: string, kind: "segment" | "smart", page = 1) => {
    setBusy("view"); setError("");
    const root = kind === "segment" ? `/tenant/crm/segments/${key}` : `/tenant/crm/smart-groups/${key}`;
    try {
      const [preview, clients] = await Promise.all([
        api<Preview>(`${root}/preview`),
        api<ClientPage>(`${root}/clients?page=${page}&pageSize=20`),
      ]);
      setView({ key, kind, preview, clients });
    } catch (reason) { setError((reason as Error).message); setView(null); }
    finally { setBusy(""); }
  };

  const newSegment = () => { setBuilder({ name: "", description: "", criteria: newGroup(fields, true) }); setBuilderPreview(null); setNotice(""); };
  const editSegment = (segment: Segment) => {
    setBuilder({ id: segment.id, name: segment.name, description: segment.description ?? "", criteria: segment.criteria });
    setBuilderPreview(null); setError(""); setNotice("");
  };

  const previewBuilder = async () => {
    if (!builder) return;
    setBusy("preview"); setError("");
    try { setBuilderPreview(await api<Preview>("/tenant/crm/segments/preview", json("POST", { criteria: builder.criteria }))); }
    catch (reason) { setError((reason as Error).message); setBuilderPreview(null); }
    finally { setBusy(""); }
  };

  const saveBuilder = async (event: FormEvent) => {
    event.preventDefault();
    if (!builder || !canManage) return;
    setBusy("save"); setError(""); setNotice("");
    const body = { name: builder.name, description: builder.description || null, criteria: builder.criteria };
    try {
      if (builder.id) await api(`/tenant/crm/segments/${builder.id}`, json("PATCH", body));
      else await api("/tenant/crm/segments", json("POST", body));
      setBuilder(null); setBuilderPreview(null); setNotice("بخش‌بندی ذخیره شد."); setView(null); setRefresh((value) => value + 1);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(""); }
  };

  const toggleSegment = async (segment: Segment) => {
    setBusy(segment.id); setError("");
    try { await api(`/tenant/crm/segments/${segment.id}`, json("PATCH", { isActive: !segment.isActive })); setRefresh((value) => value + 1); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(""); }
  };

  const cloneGroup = (group: SmartGroup) => { window.location.href = `/admin/crm/segments?smartGroup=${encodeURIComponent(group.key)}`; };
  const title = mode === "smart" ? "گروه‌های هوشمند" : "بخش‌بندی مشتریان";

  if (!canRead) return <section className="tenant-crm-state"><h1>{title}</h1><p>نقش شما اجازه مشاهده بخش‌بندی مشتریان را ندارد.</p></section>;
  if (!entitled) return <section className="tenant-crm-state"><h1>{title}</h1><p>مدیریت مشتریان در اشتراک فعلی فعال نیست.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;

  return <section className="tenant-crm tenant-crm-segment-workspace" dir="rtl" aria-busy={loading || busy !== ""}>
    <header className="tenant-crm-heading"><div><p className="eyebrow">مدیریت کافه · CRM مشتریان</p><h1>{title}</h1><p>اعضا با داده‌های فعلی کافه محاسبه می‌شوند.</p></div>
      <nav className="tenant-crm-heading-actions" aria-label="بخش‌های CRM مشتریان">
        <Link href="/admin/crm">فهرست مشتریان</Link><Link href="/admin/crm/segments">بخش‌بندی‌ها</Link><Link href="/admin/crm/smart-groups">گروه‌های هوشمند</Link>
        {mode === "segments" && canManage && <button type="button" disabled={!fields.length} onClick={newSegment}>ساخت بخش‌بندی</button>}
      </nav>
    </header>
    {notice && <p className="tenant-crm-success" role="status">{notice}</p>}
    {error && <div className="tenant-crm-message" role="alert"><p>{error}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>تلاش دوباره</button></div>}
    {loading ? <p className="tenant-crm-message" role="status">در حال دریافت معیارها…</p> : mode === "segments" ? <>
      {builder && <section className="tenant-crm-section" aria-labelledby="tenant-crm-segment-editor-title">
        <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-segment-editor-title">{builder.id ? "ویرایش بخش‌بندی" : "بخش‌بندی تازه"}</h2><p>معیارها هر بار از داده‌های جاری دوباره ارزیابی می‌شوند.</p></div>
          <button type="button" onClick={() => { setBuilder(null); setBuilderPreview(null); }}>بستن فرم</button></div>
        <form className="tenant-crm-segment-form" onSubmit={(event) => void saveBuilder(event)}>
          <label className="tenant-crm-control">نام بخش‌بندی<input required minLength={1} maxLength={120} value={builder.name}
            onChange={(event) => setBuilder({ ...builder, name: event.target.value })} disabled={!canManage || busy === "save"} /></label>
          <label className="tenant-crm-control">توضیح کوتاه<input maxLength={500} value={builder.description}
            onChange={(event) => setBuilder({ ...builder, description: event.target.value })} disabled={!canManage || busy === "save"} /></label>
          {!builder.id || segments.find((item) => item.id === builder.id)?.criteriaValid !== false
            ? null : <p className="tenant-crm-inline-error" role="status">برخی فیلدها یا گزینه‌ها غیرفعال شده‌اند. شرط‌های نامعتبر را اصلاح یا حذف کنید.</p>}
          <CriteriaEditor fields={fields} criteria={builder.criteria} onChange={(criteria) => { setBuilder({ ...builder, criteria }); setBuilderPreview(null); }} disabled={!canManage} />
          <div className="tenant-crm-segment-actions"><button type="button" disabled={busy !== ""} onClick={() => void previewBuilder()}>{busy === "preview" ? "در حال پیش‌نمایش…" : "پیش‌نمایش اعضا"}</button>
            {canManage && <button type="submit" disabled={busy !== ""}>{busy === "save" ? "در حال ذخیره…" : "ذخیره بخش‌بندی"}</button>}</div>
        </form>
        {builderPreview && <div className="tenant-crm-segment-preview" role="status"><strong>{number.format(builderPreview.matchingClients)} مشتری منطبق</strong>
          {builderPreview.sample.length ? <ul>{builderPreview.sample.map((client) => <li key={client.id}><span>{client.firstName} {client.lastName}</span><span dir="ltr">{client.phone}</span></li>)}</ul> : <p>مشتری‌ای با این معیارها پیدا نشد.</p>}
        </div>}
      </section>}
      <section className="tenant-crm-section" aria-labelledby="tenant-crm-segments-title">
        <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-segments-title">بخش‌بندی‌های ذخیره‌شده</h2><p>هر بخش‌بندی معیارهای خود را نگه می‌دارد، نه فهرست ثابت مشتریان.</p></div></div>
        {segments.length ? <ul className="tenant-crm-segment-list">{segments.map((segment) => <li key={segment.id}>
          <div className="tenant-crm-segment-info"><strong>{segment.name}</strong><p>{segment.description || "بدون توضیح"}</p>
            <small>{segment.isActive ? "فعال" : "غیرفعال"}{!segment.criteriaValid ? " · معیار نیازمند بازبینی" : ""}</small>
          </div><div className="tenant-crm-segment-actions">
            <button type="button" disabled={busy !== "" || !segment.criteriaValid} onClick={() => void openView(segment.id, "segment")}>مشاهده اعضا</button>
            {canManage && <button type="button" disabled={busy !== ""} onClick={() => editSegment(segment)}>ویرایش</button>}
            {canManage && <button type="button" disabled={busy !== ""} onClick={() => void toggleSegment(segment)}>{segment.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}</button>}
          </div>
        </li>)}</ul> : <div className="tenant-crm-empty"><h2>{segmentTotal ? "در این صفحه بخشی نیست" : "هنوز بخش‌بندی‌ای نساخته‌اید"}</h2><p>برای گروه‌بندی پویای مشتریان، یک معیار بسازید.</p></div>}
        {segmentTotal > 25 && <footer className="tenant-crm-pagination"><span>{number.format(segmentTotal)} بخش‌بندی</span><div>
          <button type="button" disabled={segmentPage <= 1 || busy !== ""} onClick={() => setSegmentPage((page) => page - 1)}>قبلی</button>
          <span>صفحه {number.format(segmentPage)} از {number.format(Math.ceil(segmentTotal / 25))}</span>
          <button type="button" disabled={segmentPage >= Math.ceil(segmentTotal / 25) || busy !== ""} onClick={() => setSegmentPage((page) => page + 1)}>بعدی</button>
        </div></footer>}
      </section>
    </> : <section className="tenant-crm-section" aria-labelledby="tenant-crm-smart-groups-title">
      <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-smart-groups-title">گروه‌های آماده</h2><p>تعریف هر گروه روشن است و از همان ارزیابی بخش‌بندی‌ها استفاده می‌کند.</p></div></div>
      {groups.length ? <ul className="tenant-crm-smart-list">{groups.map((group) => <li key={group.key}>
        <div><strong>{group.name}</strong><p>{group.description}</p></div><div className="tenant-crm-segment-actions">
          <button type="button" disabled={busy !== ""} onClick={() => void openView(group.key, "smart")}>مشاهده اعضا</button>
          {canManage && <button type="button" disabled={busy !== ""} onClick={() => cloneGroup(group)}>ساخت بخش‌بندی از این گروه</button>}
        </div>
      </li>)}</ul> : <p className="tenant-crm-inline-empty">گروه آماده‌ای در دسترس نیست.</p>}
    </section>}
    {view && <section className="tenant-crm-section tenant-crm-segment-members" aria-labelledby="tenant-crm-member-title">
      <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-member-title">اعضای جاری</h2><p>{number.format(view.preview.matchingClients)} مشتری در این گروه قرار دارند.</p></div>
        <button type="button" onClick={() => setView(null)}>بستن اعضا</button></div>
      {view.clients.items.length ? <ul className="tenant-crm-segment-client-list">{view.clients.items.map((client) => <li key={client.id}>
        <Link href={`/admin/crm/clients/${client.id}`}><strong>{client.firstName} {client.lastName}</strong><span dir="ltr">{client.phone}</span><small>عضویت از {date(client.createdAt)}</small></Link>
      </li>)}</ul> : <p className="tenant-crm-inline-empty">این گروه در حال حاضر عضوی ندارد.</p>}
      {view.clients.total > view.clients.pageSize && <footer className="tenant-crm-pagination"><span>{number.format(view.clients.total)} مشتری</span><div>
        <button type="button" disabled={view.clients.page <= 1 || busy !== ""} onClick={() => void openView(view.key, view.kind, view.clients.page - 1)}>قبلی</button>
        <span>صفحه {number.format(view.clients.page)} از {number.format(Math.ceil(view.clients.total / view.clients.pageSize))}</span>
        <button type="button" disabled={view.clients.page >= Math.ceil(view.clients.total / view.clients.pageSize) || busy !== ""} onClick={() => void openView(view.key, view.kind, view.clients.page + 1)}>بعدی</button>
      </div></footer>}
    </section>}
  </section>;
}
