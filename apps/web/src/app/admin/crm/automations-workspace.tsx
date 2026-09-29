"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { TenantPermission, useAdminSession } from "../admin-session";
import { CriteriaEditor, FilterField, Group } from "./segments-workspace";

type Trigger = "ORDER_DELIVERED" | "FEEDBACK_CREATED" | "FEEDBACK_RESOLVED" | "CLIENT_LAPSED" | "CLIENT_BIRTHDAY";
type ActionType = "ADD_TAG" | "REMOVE_TAG" | "CREATE_REMINDER" | "ADD_NOTE";
type Action = { type: ActionType; config: Record<string, unknown> };
type Automation = { id: string; name: string; description: string | null; status: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  triggerType: Trigger; triggerConfig: Record<string, unknown>; conditions: Group | null; actions: Action[]; version: number; activatedAt: string | null };
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type Metadata = { fields: FilterField[]; tags: Array<{ id: string; name: string }>; users: Array<{ id: string; label: string }> };
type Execution = { id: string; clientId: string; clientFirstName: string; clientLastName: string; triggerType: Trigger; status: string;
  attempts: number; errorCode: string | null; errorMessage: string | null; createdAt: string; actionExecutions?: Array<{ id: string;
    actionIndex: number; actionType: ActionType; status: string; attempts: number; errorCode: string | null; errorMessage: string | null }> };
type Builder = { id?: string; status?: Automation["status"]; name: string; description: string; triggerType: Trigger;
  triggerConfig: Record<string, unknown>; conditions: Group | null; actions: Action[] };

const number = new Intl.NumberFormat("fa-IR");
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const triggers: Array<{ value: Trigger; label: string }> = [
  { value: "ORDER_DELIVERED", label: "سفارش تحویل شد" }, { value: "FEEDBACK_CREATED", label: "بازخورد ثبت شد" },
  { value: "FEEDBACK_RESOLVED", label: "بازخورد رسیدگی شد" }, { value: "CLIENT_LAPSED", label: "مشتری غیرفعال شد" },
  { value: "CLIENT_BIRTHDAY", label: "روز تولد مشتری" },
];
const actionNames: Record<ActionType, string> = { ADD_TAG: "افزودن برچسب", REMOVE_TAG: "حذف برچسب", CREATE_REMINDER: "ساخت یادآور", ADD_NOTE: "ثبت یادداشت" };
const statusNames: Record<string, string> = { DRAFT: "پیش‌نویس", ACTIVE: "فعال", PAUSED: "متوقف", ARCHIVED: "بایگانی‌شده", PENDING: "در صف", PROCESSING: "در حال اجرا", SUCCEEDED: "موفق", SKIPPED: "ردشده", FAILED: "ناموفق", LOOP_BLOCKED: "توقف ایمنی" };
const triggerLabel = (value: Trigger) => triggers.find((item) => item.value === value)?.label ?? value;
const defaultAction = (): Action => ({ type: "ADD_NOTE", config: { body: "" } });
const initialBuilder = (): Builder => ({ name: "", description: "", triggerType: "ORDER_DELIVERED", triggerConfig: {}, conditions: null, actions: [defaultAction()] });
const blankGroup = (): Group => ({ type: "group", version: 1, operator: "AND", conditions: [] });
const automationPageSize = 20;
const historyPageSize = 20;

export function AutomationsWorkspace() {
  const { access, api } = useAdminSession();
  const canRead = access.permissions.includes("tenant_crm.read" as TenantPermission);
  const canManage = access.permissions.includes("tenant_crm.manage" as TenantPermission);
  const entitled = access.features?.tenant_crm === true;
  const [items, setItems] = useState<Automation[]>([]);
  const [automationPage, setAutomationPage] = useState(1);
  const [automationTotal, setAutomationTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [history, setHistory] = useState<Execution[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [expandedExecution, setExpandedExecution] = useState("");
  const [builder, setBuilder] = useState<Builder | null>(null);
  const [metadata, setMetadata] = useState<Metadata>();
  const [previewCount, setPreviewCount] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!canRead || !entitled) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError("");
    const params = new URLSearchParams({ page: String(automationPage), pageSize: String(automationPageSize) });
    if (query) params.set("q", query);
    if (statusFilter) params.set("status", statusFilter);
    if (triggerFilter) params.set("triggerType", triggerFilter);
    api<Page<Automation>>(`/tenant/crm/automations?${params}`).then((page) => {
      if (!active) return;
      setItems(page.items);
      setAutomationTotal(page.total);
      if (selectedId && !page.items.some((item) => item.id === selectedId)) setSelectedId("");
    }).catch((reason: Error) => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, automationPage, canRead, entitled, query, refresh, selectedId, statusFilter, triggerFilter]);

  useEffect(() => {
    if (!selectedId || !canRead || !entitled) { setHistory([]); setHistoryTotal(0); return; }
    let active = true;
    setHistory([]); setHistoryTotal(0); setExpandedExecution("");
    api<Page<Execution>>(`/tenant/crm/automations/${selectedId}/executions?page=${historyPage}&pageSize=${historyPageSize}`)
      .then((page) => { if (active) { setHistory(page.items); setHistoryTotal(page.total); } }).catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [api, canRead, entitled, historyPage, refresh, selectedId]);

  useEffect(() => {
    if (!builder) { setMetadata(undefined); return; }
    let active = true;
    setMetadata(undefined);
    api<Metadata>(`/tenant/crm/automations/metadata?triggerType=${builder.triggerType}`)
      .then((result) => { if (active) setMetadata(result); }).catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [api, builder?.triggerType]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!builder || busy) return;
    setBusy(true); setError(""); setNotice("");
    const payload = { name: builder.name, description: builder.description || null, triggerType: builder.triggerType,
      triggerConfig: builder.triggerType === "CLIENT_LAPSED" ? { days: Number(builder.triggerConfig.days ?? 45) } : {},
      conditions: builder.conditions?.conditions.length ? builder.conditions : null, actions: builder.actions };
    try {
      const saved = await api<Automation>(builder.id ? `/tenant/crm/automations/${builder.id}` : "/tenant/crm/automations", json(builder.id ? "PATCH" : "POST", payload));
      setBuilder(null); setAutomationPage(1); setHistoryPage(1); setSelectedId(saved.id); setNotice("اتوماسیون ذخیره شد."); setRefresh((value) => value + 1);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function preview() {
    if (!builder || !builder.triggerType.startsWith("CLIENT_")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ matchingClients: number }>("/tenant/crm/automations/preview", json("POST", {
        triggerType: builder.triggerType, triggerConfig: builder.triggerType === "CLIENT_LAPSED" ? { days: Number(builder.triggerConfig.days ?? 45) } : {},
        conditions: builder.conditions?.conditions.length ? builder.conditions : null,
      }));
      setPreviewCount(result.matchingClients);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function transition(automation: Automation, action: "activate" | "pause" | "archive") {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<Automation>(`/tenant/crm/automations/${automation.id}/${action}`, json("POST"));
      setNotice(action === "activate" ? "اتوماسیون فعال شد." : action === "pause" ? "اتوماسیون متوقف شد؛ اجراهای ثبت‌شده ادامه می‌یابند." : "اتوماسیون بایگانی شد.");
      setItems((current) => current.map((item) => item.id === result.id ? result : item)); setRefresh((value) => value + 1);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function openExecution(id: string) {
    if (expandedExecution === id) { setExpandedExecution(""); return; }
    setExpandedExecution(id);
    try {
      const result = await api<Execution>(`/tenant/crm/automations/executions/${id}`);
      setHistory((current) => current.map((item) => item.id === id ? result : item));
    } catch (reason) { setError((reason as Error).message); }
  }

  function edit(automation: Automation) {
    setError(""); setNotice(""); setPreviewCount(undefined); setSelectedId(automation.id);
    setBuilder({ id: automation.id, status: automation.status, name: automation.name, description: automation.description ?? "",
      triggerType: automation.triggerType, triggerConfig: automation.triggerConfig, conditions: automation.conditions,
      actions: automation.actions.map((action) => ({ type: action.type, config: action.config })) });
  }

  if (!canRead) return <section className="tenant-crm-state"><h1>اتوماسیون‌های CRM</h1><p>نقش شما اجازه مشاهده اتوماسیون‌های مشتریان را ندارد.</p></section>;
  if (!entitled) return <section className="tenant-crm-state"><h1>اتوماسیون‌های CRM</h1><p>مدیریت CRM در اشتراک فعلی فعال نیست.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;

  return <section className="tenant-crm tenant-crm-automation" dir="rtl" aria-busy={loading || busy}>
    <header className="tenant-crm-heading"><div><p className="eyebrow">مدیریت کافه · CRM مشتریان</p><h1>اتوماسیون‌های مشتریان</h1><p>رویدادها و زمان‌بندی محلی کافه را به پیگیری‌های داخلی وصل کنید.</p></div>
      <nav className="tenant-crm-heading-actions" aria-label="بخش‌های CRM"><Link href="/admin/crm">فهرست مشتریان</Link><Link href="/admin/crm/segments">بخش‌بندی‌ها</Link><Link href="/admin/crm/feedback">بازخوردها</Link>
        {canManage && <button type="button" disabled={busy} onClick={() => { setBuilder(initialBuilder()); setSelectedId(""); setPreviewCount(undefined); setError(""); }}>ساخت اتوماسیون</button>}</nav></header>
    {notice && <p className="tenant-crm-success" role="status">{notice}</p>}
    {error && <div className="tenant-crm-message" role="alert"><p>{error}</p><button type="button" onClick={() => { setError(""); setRefresh((value) => value + 1); }}>تلاش دوباره</button></div>}
    {builder && <section className="tenant-crm-section tenant-crm-automation-builder" aria-labelledby="automation-builder-title">
      <div className="tenant-crm-section-heading"><div><h2 id="automation-builder-title">{builder.id ? "ویرایش اتوماسیون" : "ساخت اتوماسیون"}</h2><p>شرط‌ها هنگام اجرای هر رخداد با داده فعلی CRM دوباره بررسی می‌شوند.</p></div><button type="button" disabled={busy} onClick={() => setBuilder(null)}>بستن فرم</button></div>
      <form className="tenant-crm-automation-form" onSubmit={(event) => void save(event)}>
        <label className="tenant-crm-control">نام<input required minLength={1} maxLength={120} value={builder.name} onChange={(event) => setBuilder({ ...builder, name: event.target.value })} /></label>
        <label className="tenant-crm-control">توضیح (اختیاری)<input maxLength={500} value={builder.description} onChange={(event) => setBuilder({ ...builder, description: event.target.value })} /></label>
        <label className="tenant-crm-control">چه زمانی اجرا شود؟<select value={builder.triggerType} onChange={(event) => {
          const triggerType = event.target.value as Trigger;
          setBuilder({ ...builder, triggerType, triggerConfig: triggerType === "CLIENT_LAPSED" ? { days: 45 } : {}, conditions: null }); setPreviewCount(undefined);
        }}>{triggers.map((trigger) => <option key={trigger.value} value={trigger.value}>{trigger.label}</option>)}</select></label>
        {builder.triggerType === "CLIENT_LAPSED" && <label className="tenant-crm-control">روز بدون سفارش تحویل‌شده<input type="number" min="1" max="3650" required value={Number(builder.triggerConfig.days ?? 45)}
          onChange={(event) => setBuilder({ ...builder, triggerConfig: { days: Number(event.target.value) }, conditions: builder.conditions })} /></label>}
        {builder.triggerType.startsWith("CLIENT_") && <div className="tenant-crm-automation-preview"><button type="button" disabled={busy} onClick={() => void preview()}>{busy ? "در حال بررسی…" : "پیش‌نمایش تعداد مشتریان"}</button>
          {previewCount !== undefined && <strong role="status">{number.format(previewCount)} مشتری با این معیارها منطبق‌اند</strong>}</div>}
        {metadata && <section aria-labelledby="automation-conditions-title"><div className="tenant-crm-section-heading"><div><h3 id="automation-conditions-title">شرط‌های اضافه</h3><p>می‌توانید شرط‌ها را با «همه» یا «هرکدام» ترکیب کنید.</p></div>
          <button type="button" disabled={busy || !metadata.fields.length} onClick={() => setBuilder({ ...builder, conditions: builder.conditions ?? blankGroup() })}>افزودن شرط</button></div>
          {builder.conditions && <CriteriaEditor fields={metadata.fields} criteria={builder.conditions} disabled={busy} onChange={(conditions) => { setBuilder({ ...builder, conditions }); setPreviewCount(undefined); }} />}</section>}
        {!metadata && <p className="tenant-crm-loading" role="status">در حال دریافت فیلدها…</p>}
        <section aria-labelledby="automation-actions-title"><div className="tenant-crm-section-heading"><div><h3 id="automation-actions-title">کارهایی که به‌ترتیب انجام می‌شود</h3><p>این نسخه از یادداشت، برچسب و یادآور داخلی پشتیبانی می‌کند.</p></div>
          <button type="button" disabled={busy || builder.actions.length >= 10} onClick={() => setBuilder({ ...builder, actions: [...builder.actions, defaultAction()] })}>افزودن کار</button></div>
          <ol className="tenant-crm-automation-actions">{builder.actions.map((action, index) => <li key={index}><div className="tenant-crm-automation-action-heading"><strong>کار {number.format(index + 1)}</strong><div>
            <button type="button" aria-label={`انتقال کار ${index + 1} به بالا`} disabled={busy || index === 0} onClick={() => moveAction(builder, setBuilder, index, -1)}>بالا</button>
            <button type="button" aria-label={`انتقال کار ${index + 1} به پایین`} disabled={busy || index === builder.actions.length - 1} onClick={() => moveAction(builder, setBuilder, index, 1)}>پایین</button>
            <button type="button" disabled={busy || builder.actions.length <= 1} onClick={() => setBuilder({ ...builder, actions: builder.actions.filter((_item, itemIndex) => itemIndex !== index) })}>حذف</button></div></div>
            <label className="tenant-crm-control">نوع کار<select value={action.type} onChange={(event) => {
              const next = [...builder.actions]; const type = event.target.value as ActionType;
              next[index] = { type, config: type === "ADD_NOTE" ? { body: "" } : type === "CREATE_REMINDER" ? { title: "", dueInDays: 0 } : { tagId: "" } };
              setBuilder({ ...builder, actions: next });
            }}>{Object.entries(actionNames).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label>
            {(action.type === "ADD_TAG" || action.type === "REMOVE_TAG") && <label className="tenant-crm-control">برچسب<select required value={String(action.config.tagId ?? "")} onChange={(event) => changeAction(builder, setBuilder, index, { ...action.config, tagId: event.target.value })}>
              <option value="">انتخاب برچسب</option>{metadata?.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>}
            {action.type === "ADD_NOTE" && <label className="tenant-crm-control">متن یادداشت<textarea required minLength={1} maxLength={1000} rows={3} value={String(action.config.body ?? "")} onChange={(event) => changeAction(builder, setBuilder, index, { ...action.config, body: event.target.value })} /></label>}
            {action.type === "CREATE_REMINDER" && <div className="tenant-crm-automation-reminder">
              <label className="tenant-crm-control">عنوان یادآور<input required maxLength={120} value={String(action.config.title ?? "")} onChange={(event) => changeAction(builder, setBuilder, index, { ...action.config, title: event.target.value })} /></label>
              <label className="tenant-crm-control">توضیح (اختیاری)<input maxLength={500} value={String(action.config.description ?? "")} onChange={(event) => changeAction(builder, setBuilder, index, { ...action.config, description: event.target.value || null })} /></label>
              <label className="tenant-crm-control">سررسید از روز اجرا<input type="number" min="0" max="3650" value={Number(action.config.dueInDays ?? 0)} onChange={(event) => changeAction(builder, setBuilder, index, { ...action.config, dueInDays: Number(event.target.value) })} /></label>
              <label className="tenant-crm-control">مسئول (اختیاری)<select value={String(action.config.assignedToUserId ?? "")} onChange={(event) => changeAction(builder, setBuilder, index, { ...action.config, assignedToUserId: event.target.value || null })}>
                <option value="">بدون مسئول مشخص</option>{metadata?.users.map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}</select></label>
            </div>}
          </li>)}</ol>
        </section>
        <div className="tenant-crm-automation-submit"><button type="submit" disabled={busy || !metadata}>{busy ? "در حال ذخیره…" : "ذخیره پیش‌نویس"}</button></div>
      </form>
    </section>}
    <form className="tenant-crm-automation-filters" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); setAutomationPage(1); }}>
      <label className="tenant-crm-control">جست‌وجوی نام<input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} /></label>
      <label className="tenant-crm-control">وضعیت<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setAutomationPage(1); }}>
        <option value="">همه وضعیت‌ها</option>{["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"].map((status) => <option key={status} value={status}>{statusNames[status]}</option>)}</select></label>
      <label className="tenant-crm-control">رویداد<select value={triggerFilter} onChange={(event) => { setTriggerFilter(event.target.value); setAutomationPage(1); }}>
        <option value="">همه رویدادها</option>{triggers.map((trigger) => <option key={trigger.value} value={trigger.value}>{trigger.label}</option>)}</select></label>
      <button type="submit">جست‌وجو</button>
      {(query || statusFilter || triggerFilter) && <button type="button" onClick={() => { setSearch(""); setQuery(""); setStatusFilter(""); setTriggerFilter(""); setAutomationPage(1); }}>پاک‌کردن فیلترها</button>}
    </form>
    {loading ? <p className="tenant-crm-message" role="status">در حال دریافت اتوماسیون‌ها…</p> : items.length ? <ul className="tenant-crm-list">{items.map((automation) => <li key={automation.id}>
      <article className="tenant-crm-automation-card"><header><button type="button" className="tenant-crm-automation-select" aria-expanded={selectedId === automation.id} onClick={() => { setHistoryPage(1); setSelectedId(selectedId === automation.id ? "" : automation.id); }}>
        <span><strong>{automation.name}</strong><small>{triggerLabel(automation.triggerType)} · نسخه {number.format(automation.version)}</small></span><span className={`tenant-crm-status tenant-crm-automation-${automation.status.toLowerCase()}`}>{statusNames[automation.status]}</span></button></header>
        {automation.description && <p>{automation.description}</p>}<div className="tenant-crm-automation-summary"><span>{automation.actions.map((action) => actionNames[action.type]).join(" ← ")}</span><span>{number.format(automation.actions.length)} کار</span></div>
        {canManage && <div className="tenant-crm-automation-buttons">{automation.status !== "ARCHIVED" && <button type="button" disabled={busy} onClick={() => edit(automation)}>ویرایش</button>}
          {automation.status === "ACTIVE" && <button type="button" disabled={busy} onClick={() => void transition(automation, "pause")}>توقف</button>}
          {(automation.status === "DRAFT" || automation.status === "PAUSED") && <button type="button" disabled={busy} onClick={() => void transition(automation, "activate")}>فعال‌سازی</button>}
          {(automation.status === "DRAFT" || automation.status === "PAUSED") && <button type="button" disabled={busy} onClick={() => void transition(automation, "archive")}>بایگانی</button>}</div>}
        {selectedId === automation.id && <section className="tenant-crm-automation-history" id={`automation-history-${automation.id}`}><h3>تاریخچه اجرا</h3>{history.length ? <ol>{history.map((execution) => <li key={execution.id}>
          <button type="button" onClick={() => void openExecution(execution.id)} aria-expanded={expandedExecution === execution.id}><span><strong>{execution.clientFirstName} {execution.clientLastName}</strong><small>{new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone: access.tenant.timezone }).format(new Date(execution.createdAt))}</small></span>
            <span className={`tenant-crm-status tenant-crm-automation-${execution.status.toLowerCase()}`}>{statusNames[execution.status] ?? execution.status}</span></button>
          {execution.errorMessage && <p role="status">{execution.errorMessage} · {execution.errorCode}</p>}
          {expandedExecution === execution.id && execution.actionExecutions && <ul>{execution.actionExecutions.map((action) => <li key={action.id}><span>{number.format(action.actionIndex + 1)}. {actionNames[action.actionType]}</span><span>{statusNames[action.status] ?? action.status}</span>{action.errorMessage && <small>{action.errorMessage}</small>}</li>)}</ul>}
        </li>)}</ol> : <p className="tenant-crm-inline-empty">هنوز اجرایی ثبت نشده است.</p>}
        {historyTotal > historyPageSize && <nav className="tenant-crm-pagination" aria-label="صفحه‌های تاریخچه اجرا"><span>صفحه {number.format(historyPage)} از {number.format(Math.ceil(historyTotal / historyPageSize))} · {number.format(historyTotal)} اجرا</span><div>
          <button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage((page) => page - 1)}>صفحه قبل</button>
          <button type="button" disabled={historyPage >= Math.ceil(historyTotal / historyPageSize)} onClick={() => setHistoryPage((page) => page + 1)}>صفحه بعد</button></div></nav>}</section>}
      </article></li>)}</ul> : <div className="tenant-crm-empty"><h2>اتوماسیونی ندارید</h2><p>یک رویداد یا زمان‌بندی محلی را به کارهای داخلی CRM وصل کنید.</p></div>}
    {!loading && automationTotal > automationPageSize && <nav className="tenant-crm-pagination" aria-label="صفحه‌های اتوماسیون"><span>صفحه {number.format(automationPage)} از {number.format(Math.ceil(automationTotal / automationPageSize))} · {number.format(automationTotal)} اتوماسیون</span><div>
      <button type="button" disabled={automationPage <= 1} onClick={() => setAutomationPage((page) => page - 1)}>صفحه قبل</button>
      <button type="button" disabled={automationPage >= Math.ceil(automationTotal / automationPageSize)} onClick={() => setAutomationPage((page) => page + 1)}>صفحه بعد</button></div></nav>}
  </section>;
}

function changeAction(builder: Builder, setBuilder: (value: Builder) => void, index: number, config: Record<string, unknown>) {
  const actions = [...builder.actions]; actions[index] = { ...actions[index]!, config }; setBuilder({ ...builder, actions });
}

function moveAction(builder: Builder, setBuilder: (value: Builder) => void, index: number, offset: -1 | 1) {
  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= builder.actions.length) return;
  const actions = [...builder.actions];
  [actions[index], actions[nextIndex]] = [actions[nextIndex]!, actions[index]!];
  setBuilder({ ...builder, actions });
}
