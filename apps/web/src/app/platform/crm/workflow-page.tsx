"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { PlatformApi as Api, usePlatformSession } from "../use-platform-session";
import { CrmEntityType, CrmFilterBuilder, FilterDefinition, initialFilter, isFilterReady } from "./metadata-controls";
import { CrmShell } from "./workspace";

type Entity = "ORGANIZATION" | "LEAD" | "DEAL";
type ActionType = "CREATE_TASK" | "ADD_TAG" | "REMOVE_TAG" | "ASSIGN_LEAD_OWNER" | "ASSIGN_DEAL_OWNER";
type Trigger = "LEAD_CREATED" | "LEAD_QUALIFIED" | "LEAD_CONVERTED" | "LEAD_STATUS_CHANGED" | "DEAL_CREATED" | "DEAL_STAGE_CHANGED" | "DEAL_WON" | "DEAL_LOST" | "ACTIVITY_CREATED" | "TASK_COMPLETED" | "LEAD_SCORE_CHANGED" | "LEAD_SCORE_CROSSED_THRESHOLD" | "TASK_OVERDUE" | "TRIAL_ENDING";
type Action = { type: ActionType; config: Record<string, unknown> };
type Workflow = { id: string; name: string; description: string | null; triggerType: Trigger; triggerConfig: Record<string, unknown>; conditionEntityType: Entity; conditions: FilterDefinition; actions: Action[]; enabled: boolean; version: number; valid?: boolean; createdAt: string; updatedAt: string };
type Execution = { id: string; workflowId: string; workflowVersion: number; triggerType: Trigger; recordType: Entity; recordId: string; status: string; errorCode: string | null; startedAt: string; completedAt: string | null; failedAt: string | null; actionCount: number; succeededActions: number };
type ExecutionDetail = Execution & { workflowName: string; triggerContext: Record<string, unknown>; triggeredAt: string; errorMessage: string | null; correlationId: string; automationDepth: number; workflowSnapshot: Workflow; actions: { id: string; actionIndex: number; actionType: ActionType; config: Record<string, unknown>; status: string; attempt: number; completedAt: string | null; resultMetadata: Record<string, unknown>; errorCode: string | null; errorMessage: string | null; nextAttemptAt: string | null }[] };
type User = { id: string; label: string };
type Tag = { id: string; name: string; active: boolean; archivedAt: string | null };
type Draft = Omit<Workflow, "id" | "version" | "createdAt" | "updatedAt" | "valid">;

const fa = new Intl.NumberFormat("fa-IR");
const triggerLabels: Record<Trigger, string> = { LEAD_CREATED: "ایجاد سرنخ", LEAD_QUALIFIED: "تأیید سرنخ", LEAD_CONVERTED: "تبدیل سرنخ", LEAD_STATUS_CHANGED: "تغییر وضعیت سرنخ", DEAL_CREATED: "ایجاد فرصت", DEAL_STAGE_CHANGED: "تغییر مرحله فرصت", DEAL_WON: "برد فرصت", DEAL_LOST: "از دست‌رفتن فرصت", ACTIVITY_CREATED: "ثبت تعامل", TASK_COMPLETED: "انجام وظیفه", LEAD_SCORE_CHANGED: "تغییر امتیاز سرنخ", LEAD_SCORE_CROSSED_THRESHOLD: "عبور امتیاز سرنخ از آستانه", TASK_OVERDUE: "سررسید وظیفه", TRIAL_ENDING: "نزدیک‌شدن پایان دوره آزمایشی" };
const entityLabels: Record<Entity, string> = { ORGANIZATION: "سازمان", LEAD: "سرنخ", DEAL: "فرصت" };
const actionLabels: Record<ActionType, string> = { CREATE_TASK: "ایجاد وظیفه", ADD_TAG: "افزودن برچسب", REMOVE_TAG: "برداشتن برچسب", ASSIGN_LEAD_OWNER: "تعیین مسئول سرنخ", ASSIGN_DEAL_OWNER: "تعیین مسئول فرصت" };
const statusLabels: Record<string, string> = { PENDING: "در صف", RUNNING: "در حال اجرا", RETRYING: "تلاش دوباره", SUCCEEDED: "موفق", FAILED: "ناموفق" };
const entities: { value: Entity; label: string }[] = [{ value: "ORGANIZATION", label: "سازمان" }, { value: "LEAD", label: "سرنخ" }, { value: "DEAL", label: "فرصت" }];
const triggers = Object.keys(triggerLabels) as Trigger[];
const baseAction = (type: ActionType, entity: Entity): Action => type === "CREATE_TASK" ? { type, config: { recordType: entity, title: "", description: null, dueInDays: 1, priority: "NORMAL", kind: "FOLLOW_UP", assigneeStrategy: entity === "ORGANIZATION" ? "UNASSIGNED" : "RECORD_OWNER", userId: null } } : type === "ADD_TAG" || type === "REMOVE_TAG" ? { type, config: { recordType: entity, tagId: "" } } : { type, config: { userId: "" } };
const emptyDraft = (): Draft => ({ name: "", description: "", triggerType: "LEAD_CREATED", triggerConfig: {}, conditionEntityType: "LEAD", conditions: initialFilter(), actions: [baseAction("CREATE_TASK", "LEAD")], enabled: false });
const defaultEntity = (trigger: Trigger): Entity => trigger.startsWith("LEAD_") ? "LEAD" : trigger.startsWith("DEAL_") ? "DEAL" : "ORGANIZATION";
const defaultTriggerConfig = (trigger: Trigger) => trigger === "LEAD_SCORE_CROSSED_THRESHOLD" ? { threshold: 80, direction: "ABOVE" } : trigger === "TRIAL_ENDING" ? { daysBefore: 3 } : {};
const dateLabel = (value?: string | null) => value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

export function CrmWorkflowPage() {
  const { state, access, api } = usePlatformSession();
  if (state === "loading") return <main className="platform-entry"><p role="status">در حال بررسی دسترسی…</p></main>;
  if (state !== "ready" || !access.includes("crm.read")) return <main className="platform-entry"><section><h1>دسترسی CRM فعال نیست</h1><p>برای دیدن گردش‌کارها به دسترسی crm.read نیاز دارید.</p><Link className="crm-button" href="/platform">بازگشت به پنل پلتفرم</Link></section></main>;
  return <CrmShell canManage={access.includes("crm.manage")}><WorkflowWorkspace api={api} canManage={access.includes("crm.manage")} /></CrmShell>;
}

function WorkflowWorkspace({ api, canManage }: { api: Api; canManage: boolean }) {
  const [items, setItems] = useState<Workflow[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [selected, setSelected] = useState("");
  const [historyId, setHistoryId] = useState("");
  const [selectedValid, setSelectedValid] = useState<boolean | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setItems(await api<Workflow[]>("/platform/crm/workflows")); }
    catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!canManage) return;
    void Promise.all([api<User[]>("/platform/crm/leads/assignees"), api<Tag[]>("/platform/crm/tags")]).then(([nextUsers, nextTags]) => { setUsers(nextUsers); setTags(nextTags); }).catch(() => setError("فهرست مسئولان یا برچسب‌ها بارگذاری نشد؛ اتصال و دسترسی را بررسی کنید."));
  }, [api, canManage]);
  useEffect(() => {
    if (!historyId) { setExecutions([]); setHistoryLoading(false); return; }
    let cancelled = false;
    setHistoryLoading(true);
    void api<{ items: Execution[] }>(`/platform/crm/workflows/${historyId}/executions?page=1&pageSize=10`).then((result) => { if (!cancelled) setExecutions(result.items); }).catch((reason) => { if (!cancelled) setError((reason as Error).message); }).finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [api, historyId]);

  function startNew() { setSelected(""); setHistoryId(""); setSelectedValid(null); setDraft(emptyDraft()); setError(""); setNotice(""); setConfirmArchive(false); }
  async function edit(item: Workflow) {
    setBusy(true); setError(""); setNotice("");
    try {
      const workflow = await api<Workflow>(`/platform/crm/workflows/${item.id}`);
      setSelected(workflow.id);
      setHistoryId(workflow.id);
      setSelectedValid(workflow.valid ?? true);
      setDraft({ name: workflow.name, description: workflow.description ?? "", triggerType: workflow.triggerType, triggerConfig: workflow.triggerConfig ?? {}, conditionEntityType: workflow.conditionEntityType, conditions: workflow.conditions, actions: workflow.actions, enabled: workflow.enabled });
      setConfirmArchive(false);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<Workflow>(`/platform/crm/workflows${selected ? `/${selected}` : ""}`, { method: selected ? "PATCH" : "POST", body: JSON.stringify(draft) });
      setSelected(result.id); setHistoryId(result.id); setSelectedValid(true); setDraft({ name: result.name, description: result.description ?? "", triggerType: result.triggerType, triggerConfig: result.triggerConfig, conditionEntityType: result.conditionEntityType, conditions: result.conditions, actions: result.actions, enabled: result.enabled });
      setNotice("گردش‌کار ذخیره شد."); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function toggle(item: Workflow) {
    setBusy(true); setError("");
    try { await api(`/platform/crm/workflows/${item.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !item.enabled }) }); setNotice(item.enabled ? "گردش‌کار غیرفعال شد." : "گردش‌کار فعال شد."); await load(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function archive() {
    if (!selected) return;
    setBusy(true); setError("");
    try { await api(`/platform/crm/workflows/${selected}/archive`, { method: "POST" }); setNotice("گردش‌کار بایگانی شد."); startNew(); await load(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  function setAction(index: number, action: Action) { setDraft((current) => ({ ...current, actions: current.actions.map((item, at) => at === index ? action : item) })); }
  function moveAction(index: number, delta: -1 | 1) { setDraft((current) => { const actions = [...current.actions]; const next = index + delta; [actions[index], actions[next]] = [actions[next]!, actions[index]!]; return { ...current, actions }; }); }

  const incompatibleActions = draft.actions.filter((action) => action.type === "ASSIGN_LEAD_OWNER" && draft.conditionEntityType !== "LEAD" || action.type === "ASSIGN_DEAL_OWNER" && draft.conditionEntityType !== "DEAL");
  const canSave = Boolean(draft.name.trim()) && isFilterReady(draft.conditions) && draft.actions.length > 0 && draft.actions.length <= 10 && incompatibleActions.length === 0 && draft.actions.every((action) => action.type !== "CREATE_TASK" || Boolean(String(action.config.title ?? "").trim()) && Number(action.config.dueInDays) >= 1) && draft.actions.every((action) => !["ADD_TAG", "REMOVE_TAG"].includes(action.type) || Boolean(action.config.tagId));
  return <>
    <header className="crm-heading"><div><p className="platform-nav-label">پلتفرم / CRM</p><h1>گردش‌کارهای خودکار</h1><p>رویدادهای CRM را با شرط‌های مشخص به پیگیری‌های امن تبدیل کنید.</p></div>{canManage && <button type="button" onClick={startNew}>گردش‌کار جدید</button>}</header>
    {notice && <p className="message success" role="status">{notice}</p>}{error && <p className="message error" role="alert">{error}</p>}
    <section className="crm-workflow-list" aria-labelledby="crm-workflow-list-title"><header><div><h2 id="crm-workflow-list-title">گردش‌کارها</h2><p>حداکثر ۱۰۰ گردش‌کار می‌توانند هم‌زمان فعال باشند.</p></div><span>{fa.format(items.length)} مورد</span></header>
      {loading ? <p role="status">در حال دریافت گردش‌کارها…</p> : items.length ? <div className="crm-workflow-table-wrap"><table className="crm-workflow-table"><thead><tr><th scope="col">نام</th><th scope="col">محرک</th><th scope="col">وضعیت</th><th scope="col">تاریخچه</th>{canManage && <th scope="col">مدیریت</th>}</tr></thead><tbody>{items.map((item) => <tr key={item.id}><th scope="row"><strong>{item.name}</strong><small>نسخه {fa.format(item.version)} · {item.actions.length} اقدام</small>{item.description && <small>{item.description}</small>}</th><td>{triggerLabels[item.triggerType]}</td><td><span className={`crm-workflow-state${item.enabled ? " is-enabled" : ""}`}>{item.enabled ? "فعال" : "غیرفعال"}</span></td><td><button type="button" className="crm-secondary" onClick={() => setHistoryId(item.id)}>نمایش اجراها</button></td>{canManage && <td><div className="crm-workflow-row-actions"><button type="button" className="crm-secondary" disabled={busy} onClick={() => void edit(item)}>ویرایش</button><button type="button" disabled={busy} onClick={() => void toggle(item)}>{item.enabled ? "غیرفعال‌کردن" : "فعال‌کردن"}</button></div></td>}</tr>)}</tbody></table></div> : <div className="crm-workflow-empty"><strong>هنوز گردش‌کاری ساخته نشده است.</strong><p>برای نمونه می‌توانید هنگام تغییر مرحله فرصت، یک وظیفه پیگیری بسازید.</p>{canManage && <button type="button" onClick={startNew}>ساخت اولین گردش‌کار</button>}</div>}
    </section>

    {canManage && <form className="crm-workflow-editor" onSubmit={(event) => void save(event)} aria-labelledby="crm-workflow-editor-title">
      <header><div><h2 id="crm-workflow-editor-title">{selected ? "ویرایش گردش‌کار" : "ساخت گردش‌کار"}</h2><p>اقدام‌ها به‌ترتیب اجرا می‌شوند؛ خطا ادامه زنجیره را متوقف می‌کند.</p></div>{selected && <button type="button" className="crm-danger" onClick={() => setConfirmArchive((value) => !value)}>بایگانی</button>}</header>
      {confirmArchive && <div className="crm-workflow-confirm" role="group" aria-label="تأیید بایگانی"><p>گردش‌کار غیرفعال و بایگانی شود؟</p><button type="button" className="crm-danger" disabled={busy} onClick={() => void archive()}>بله، بایگانی کن</button><button type="button" className="crm-secondary" onClick={() => setConfirmArchive(false)}>انصراف</button></div>}
      <div className="crm-workflow-fields"><label>نام گردش‌کار<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>توضیح کوتاه<input maxLength={500} value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label></div>
      <fieldset className="crm-workflow-section"><legend>۱. محرک</legend><div className="crm-workflow-fields"><label>رویدادی که شروع می‌کند<select value={draft.triggerType} onChange={(event) => { const triggerType = event.target.value as Trigger; const conditionEntityType = defaultEntity(triggerType); setDraft({ ...draft, triggerType, triggerConfig: defaultTriggerConfig(triggerType), conditionEntityType, actions: draft.actions.map((action) => ["CREATE_TASK", "ADD_TAG", "REMOVE_TAG"].includes(action.type) ? { ...action, config: { ...action.config, recordType: conditionEntityType, ...(action.type === "CREATE_TASK" && conditionEntityType === "ORGANIZATION" ? { assigneeStrategy: "UNASSIGNED", userId: null } : {}) } } : action) }); }}>{triggers.map((trigger) => <option key={trigger} value={trigger}>{triggerLabels[trigger]}</option>)}</select></label>
        {draft.triggerType === "LEAD_STATUS_CHANGED" && <><label>از وضعیت<select value={String(draft.triggerConfig.fromStatus ?? "")} onChange={(event) => setDraft({ ...draft, triggerConfig: { ...draft.triggerConfig, fromStatus: event.target.value || undefined } })}><option value="">هر وضعیتی</option>{["NEW", "ATTEMPTING_CONTACT", "CONTACTED", "QUALIFIED", "NURTURING", "UNQUALIFIED", "CONVERTED"].map((value) => <option key={value}>{value}</option>)}</select></label><label>به وضعیت<select value={String(draft.triggerConfig.toStatus ?? "")} onChange={(event) => setDraft({ ...draft, triggerConfig: { ...draft.triggerConfig, toStatus: event.target.value || undefined } })}><option value="">هر وضعیتی</option>{["NEW", "ATTEMPTING_CONTACT", "CONTACTED", "QUALIFIED", "NURTURING", "UNQUALIFIED", "CONVERTED"].map((value) => <option key={value}>{value}</option>)}</select></label></>}
        {draft.triggerType === "DEAL_STAGE_CHANGED" && <><label>از مرحله<select value={String(draft.triggerConfig.fromStage ?? "")} onChange={(event) => setDraft({ ...draft, triggerConfig: { ...draft.triggerConfig, fromStage: event.target.value || undefined } })}><option value="">هر مرحله‌ای</option>{["DISCOVERY", "DEMO_SCHEDULED", "DEMO_COMPLETED", "TRIAL_PROPOSED", "TRIAL_ACTIVE", "DECISION"].map((value) => <option key={value}>{value}</option>)}</select></label><label>به مرحله<select value={String(draft.triggerConfig.toStage ?? "")} onChange={(event) => setDraft({ ...draft, triggerConfig: { ...draft.triggerConfig, toStage: event.target.value || undefined } })}><option value="">هر مرحله‌ای</option>{["DISCOVERY", "DEMO_SCHEDULED", "DEMO_COMPLETED", "TRIAL_PROPOSED", "TRIAL_ACTIVE", "DECISION"].map((value) => <option key={value}>{value}</option>)}</select></label></>}
        {draft.triggerType === "LEAD_SCORE_CROSSED_THRESHOLD" && <><label>آستانه امتیاز<input type="number" required min={1} max={100} value={String(draft.triggerConfig.threshold ?? 80)} onChange={(event) => setDraft({ ...draft, triggerConfig: { ...draft.triggerConfig, threshold: Number(event.target.value) } })} /></label><label>جهت عبور<select value={String(draft.triggerConfig.direction ?? "ABOVE")} onChange={(event) => setDraft({ ...draft, triggerConfig: { ...draft.triggerConfig, direction: event.target.value } })}><option value="ABOVE">عبور به بالا</option><option value="BELOW">عبور به پایین</option></select></label></>}
        {draft.triggerType === "TRIAL_ENDING" && <label>چند روز مانده به پایان<input type="number" required min={1} max={30} value={String(draft.triggerConfig.daysBefore ?? 3)} onChange={(event) => setDraft({ ...draft, triggerConfig: { ...draft.triggerConfig, daysBefore: Number(event.target.value) } })} /></label>}
      </div><p className="crm-workflow-hint">رویدادهای محرک از تغییرات ثبت‌شده در CRM می‌آیند. تغییرات پرداخت و اشتراک فقط خواندنی هستند.</p></fieldset>

      <fieldset className="crm-workflow-section"><legend>۲. شرط‌ها</legend><label className="crm-workflow-condition-entity">نوع رکورد برای شرط‌ها<select value={draft.conditionEntityType} onChange={(event) => { const conditionEntityType = event.target.value as Entity; setDraft({ ...draft, conditionEntityType, actions: draft.actions.map((action) => ["CREATE_TASK", "ADD_TAG", "REMOVE_TAG"].includes(action.type) ? { ...action, config: { ...action.config, recordType: conditionEntityType, ...(action.type === "CREATE_TASK" && conditionEntityType === "ORGANIZATION" ? { assigneeStrategy: "UNASSIGNED", userId: null } : {}) } } : action) }); }}>{entities.map((entity) => <option key={entity.value} value={entity.value}>{entity.label}</option>)}</select></label><CrmFilterBuilder api={api} entityType={draft.conditionEntityType as CrmEntityType} value={draft.conditions} onChange={(conditions) => setDraft({ ...draft, conditions })} heading="شرط‌های اجرا" description="همان فیلدهای استاندارد، برچسب‌ها و فیلدهای سفارشی CRM؛ هر شرط روی رکورد جاری اجرا می‌شود." /></fieldset>

      <fieldset className="crm-workflow-section"><legend>۳. اقدام‌ها</legend><ol className="crm-workflow-actions">{draft.actions.map((action, index) => <li key={`${index}-${action.type}`}><div className="crm-workflow-action-heading"><strong>{fa.format(index + 1)}. {actionLabels[action.type]}</strong><div><button type="button" className="crm-secondary" aria-label={`انتقال اقدام ${index + 1} به بالا`} disabled={index === 0} onClick={() => moveAction(index, -1)}>↑</button><button type="button" className="crm-secondary" aria-label={`انتقال اقدام ${index + 1} به پایین`} disabled={index === draft.actions.length - 1} onClick={() => moveAction(index, 1)}>↓</button><button type="button" className="crm-danger" aria-label={`حذف اقدام ${index + 1}`} disabled={draft.actions.length <= 1} onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, at) => at !== index) })}>حذف</button></div></div>
          <label>نوع اقدام<select value={action.type} onChange={(event) => setAction(index, baseAction(event.target.value as ActionType, draft.conditionEntityType))}>{!((action.type !== "ASSIGN_LEAD_OWNER" || draft.conditionEntityType === "LEAD") && (action.type !== "ASSIGN_DEAL_OWNER" || draft.conditionEntityType === "DEAL")) && <option value={action.type}>{actionLabels[action.type]} (با این نوع رکورد سازگار نیست)</option>}{Object.entries(actionLabels).filter(([value]) => value !== "ASSIGN_LEAD_OWNER" || draft.conditionEntityType === "LEAD").filter(([value]) => value !== "ASSIGN_DEAL_OWNER" || draft.conditionEntityType === "DEAL").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {action.type === "CREATE_TASK" && <div className="crm-workflow-fields"><label>عنوان وظیفه<input required maxLength={200} value={String(action.config.title ?? "")} onChange={(event) => setAction(index, { ...action, config: { ...action.config, title: event.target.value } })} /></label><label>موعد بعد از محرک (روز)<input type="number" min={1} max={365} required value={String(action.config.dueInDays ?? 1)} onChange={(event) => setAction(index, { ...action, config: { ...action.config, dueInDays: Number(event.target.value) } })} /></label><label>اولویت<select value={String(action.config.priority ?? "NORMAL")} onChange={(event) => setAction(index, { ...action, config: { ...action.config, priority: event.target.value } })}>{[["LOW", "کم"], ["NORMAL", "عادی"], ["HIGH", "زیاد"], ["URGENT", "فوری"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>مسئول<select value={String(action.config.assigneeStrategy ?? "UNASSIGNED")} onChange={(event) => setAction(index, { ...action, config: { ...action.config, assigneeStrategy: event.target.value, userId: null } })}><option value="UNASSIGNED">بدون مسئول</option>{draft.conditionEntityType !== "ORGANIZATION" && <option value="RECORD_OWNER">مسئول رکورد</option>}<option value="SPECIFIC_USER">کاربر مشخص</option></select></label>{action.config.assigneeStrategy === "SPECIFIC_USER" && <label>کاربر مسئول<select required value={String(action.config.userId ?? "")} onChange={(event) => setAction(index, { ...action, config: { ...action.config, userId: event.target.value } })}><option value="">انتخاب کنید</option>{users.map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}</select></label>}<label className="crm-workflow-wide">توضیح وظیفه<textarea maxLength={4000} rows={2} value={String(action.config.description ?? "")} onChange={(event) => setAction(index, { ...action, config: { ...action.config, description: event.target.value || null } })} /></label></div>}
          {(action.type === "ADD_TAG" || action.type === "REMOVE_TAG") && <label>برچسب<select required value={String(action.config.tagId ?? "")} onChange={(event) => setAction(index, { ...action, config: { ...action.config, tagId: event.target.value } })}><option value="">انتخاب کنید</option>{tags.filter((tag) => tag.active && !tag.archivedAt).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>}
          {(action.type === "ASSIGN_LEAD_OWNER" || action.type === "ASSIGN_DEAL_OWNER") && <label>مسئول جدید<select required value={String(action.config.userId ?? "")} onChange={(event) => setAction(index, { ...action, config: { userId: event.target.value } })}><option value="">انتخاب کنید</option>{users.map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}</select></label>}
        </li>)}</ol>
        {draft.actions.length < 10 && <label className="crm-workflow-add-action">افزودن اقدام<select aria-label="نوع اقدام جدید" value="" onChange={(event) => { if (event.target.value) setDraft({ ...draft, actions: [...draft.actions, baseAction(event.target.value as ActionType, draft.conditionEntityType)] }); }}><option value="">انتخاب نوع اقدام…</option>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      </fieldset>
      <label className="crm-workflow-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> پس از ذخیره فعال باشد</label>
      {incompatibleActions.length > 0 && <p className="message warning" role="alert">اقدام تعیین مسئول با نوع رکورد شرط‌ها سازگار نیست؛ نوع اقدام را اصلاح کنید.</p>}
      {selected && selectedValid === false && <p className="message warning" role="status">پیکربندی به مرجع غیرفعال یا نامعتبر اشاره دارد؛ گردش‌کار را اصلاح و دوباره ذخیره کنید.</p>}
      <div className="crm-form-actions"><button disabled={busy || !canSave}>{busy ? "در حال ذخیره…" : "ذخیره گردش‌کار"}</button><button type="button" className="crm-secondary" onClick={startNew}>پاک‌کردن فرم</button></div>
    </form>}

    {historyId && <section className="crm-workflow-history" aria-labelledby="crm-workflow-history-title"><header><div><h2 id="crm-workflow-history-title">تاریخچه اجرا</h2><p>فقط اجراهای منطبق ثبت می‌شوند؛ شرط‌های نامنطبق حجم تاریخچه را زیاد نمی‌کنند.</p></div></header>{historyLoading ? <p role="status">در حال دریافت تاریخچه…</p> : executions.length ? <div className="crm-workflow-table-wrap"><table className="crm-workflow-table"><thead><tr><th scope="col">زمان</th><th scope="col">وضعیت</th><th scope="col">رکورد</th><th scope="col">اقدام‌ها</th><th scope="col">جزئیات</th></tr></thead><tbody>{executions.map((execution) => <tr key={execution.id}><td>{dateLabel(execution.startedAt)}</td><td><span className={`crm-workflow-state crm-workflow-${execution.status.toLowerCase()}`}>{statusLabels[execution.status] ?? execution.status}</span></td><td>{entityLabels[execution.recordType]}</td><td>{fa.format(execution.succeededActions)} از {fa.format(execution.actionCount)} موفق</td><td><Link href={`/platform/crm/workflows/executions/${execution.id}`}>نمایش اجرا</Link></td></tr>)}</tbody></table></div> : <p className="crm-workflow-empty">هنوز اجرای منطبقی ثبت نشده است.</p>}</section>}
  </>;
}

export function CrmWorkflowExecutionPage({ executionId }: { executionId: string }) {
  const { state, access, api } = usePlatformSession();
  const [execution, setExecution] = useState<ExecutionDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setExecution(await api<ExecutionDetail>(`/platform/crm/workflow-executions/${executionId}`)); setError(""); } catch (reason) { setError((reason as Error).message); } }, [api, executionId]);
  useEffect(() => { if (state === "ready" && access.includes("crm.read")) void load(); }, [state, access, load]);
  if (state === "loading") return <main className="platform-entry"><p role="status">در حال بررسی دسترسی…</p></main>;
  if (state !== "ready" || !access.includes("crm.read")) return <main className="platform-entry"><section><h1>دسترسی CRM فعال نیست</h1><p>برای دیدن جزئیات اجرا به دسترسی crm.read نیاز دارید.</p><Link className="crm-button" href="/platform">بازگشت به پنل پلتفرم</Link></section></main>;
  async function retry() { setBusy(true); setError(""); try { await api(`/platform/crm/workflow-executions/${executionId}/retry`, { method: "POST" }); await load(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  return <CrmShell canManage={access.includes("crm.manage")}><>
    <header className="crm-heading"><div><p className="platform-nav-label"><Link href="/platform/crm/workflows">گردش‌کارها</Link> / تاریخچه اجرا</p><h1>{execution?.workflowName ?? "جزئیات اجرا"}</h1><p>شناسه رویداد فنی فقط برای عیب‌یابی نمایش داده می‌شود.</p></div><Link className="crm-button crm-secondary-link" href="/platform/crm/workflows">بازگشت به گردش‌کارها</Link></header>
    {error && <p className="message error" role="alert">{error} <button type="button" className="crm-secondary" onClick={() => void load()}>تلاش دوباره</button></p>}
    {!execution ? <p role="status">در حال دریافت جزئیات اجرا…</p> : <><section className="crm-workflow-detail"><dl><div><dt>محرک</dt><dd>{triggerLabels[execution.triggerType]}</dd></div><div><dt>رکورد</dt><dd>{entityLabels[execution.recordType]}</dd></div><div><dt>وضعیت</dt><dd><span className={`crm-workflow-state crm-workflow-${execution.status.toLowerCase()}`}>{statusLabels[execution.status] ?? execution.status}</span></dd></div><div><dt>نسخه گردش‌کار</dt><dd>{fa.format(execution.workflowVersion)}</dd></div><div><dt>شروع</dt><dd>{dateLabel(execution.triggeredAt)}</dd></div><div><dt>پایان</dt><dd>{dateLabel(execution.completedAt ?? execution.failedAt)}</dd></div><div><dt>شناسه هم‌بستگی</dt><dd dir="ltr">{execution.correlationId}</dd></div><div><dt>عمق خودکارسازی</dt><dd>{fa.format(execution.automationDepth)}</dd></div></dl>
      {execution.errorMessage && <p className="message error" role="alert">{execution.errorMessage} {execution.errorCode && <small>({execution.errorCode})</small>}</p>}
    </section><section className="crm-workflow-history"><header><div><h2>نتیجه اقدام‌ها</h2><p>اقدام‌ها به ترتیب ثبت شده‌اند؛ پس از خطا، اقدام‌های بعدی اجرا نمی‌شوند.</p></div>{execution.status === "FAILED" && execution.actions.some((action) => action.status === "FAILED") && access.includes("crm.manage") && <button type="button" disabled={busy} onClick={() => void retry()}>{busy ? "در حال درخواست…" : "تلاش دوباره برای اقدام ناموفق"}</button>}</header>
      <ol className="crm-workflow-action-results">{execution.actions.map((action) => <li key={action.id}><div><strong>{fa.format(action.actionIndex + 1)}. {actionLabels[action.actionType]}</strong><span className={`crm-workflow-state crm-workflow-${action.status.toLowerCase()}`}>{statusLabels[action.status] ?? action.status}</span></div><small>{fa.format(action.attempt)} تلاش · {dateLabel(action.nextAttemptAt ?? action.completedAt)}</small>{action.errorMessage && <p className="message error" role="alert">{action.errorMessage}</p>}{Object.keys(action.resultMetadata ?? {}).length > 0 && <pre dir="auto">{JSON.stringify(action.resultMetadata, null, 2)}</pre>}</li>)}</ol>
    </section></>}
  </></CrmShell>;
}
