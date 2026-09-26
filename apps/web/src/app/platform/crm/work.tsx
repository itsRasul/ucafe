"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { PlatformApi as Api, usePlatformSession } from "../use-platform-session";

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type Context = { organizationId?: string | null; contactId?: string | null; leadId?: string | null; dealId?: string | null; displayName?: string };
type Related = { organizationId: string | null; organizationName: string | null; contactId: string | null; contactName: string | null; leadId: string | null; leadName: string | null; dealId: string | null; dealTitle: string | null };
type Activity = Related & { id: string; activityType: string; subject: string; details: string | null; occurredAt: string; outcome: string | null; actorLabel: string | null; archivedAt: string | null };
type Task = Related & { id: string; title: string; description: string | null; kind: string; status: string; priority: string; dueAt: string | null; assignedToUserId: string | null; assigneeLabel: string | null; overdue: boolean; completedAt: string | null; canceledAt: string | null; archivedAt: string | null };
type Note = Related & { id: string; body: string; authorLabel: string | null; archivedAt: string | null; createdAt: string; updatedAt: string };
type UserOption = { id: string; label: string };
type Composer = { kind: "ACTIVITY"; initial?: Activity } | { kind: "TASK"; initial?: Task; followUp?: boolean } | { kind: "NOTE"; initial?: Note };

const activityNames: Record<string, string> = { CALL: "تماس", MEETING: "جلسه", DEMO: "نمایش محصول", EMAIL: "ایمیل", SMS: "پیامک", WHATSAPP: "واتس‌اپ", OTHER: "سایر" };
const outcomeNames: Record<string, string> = { CONNECTED: "تماس برقرار شد", NO_ANSWER: "پاسخی نداد", BUSY: "خط اشغال بود", CALL_BACK_REQUESTED: "درخواست تماس دوباره", NOT_INTERESTED: "علاقه‌مند نبود", INTERESTED: "علاقه‌مند بود", INVALID_NUMBER: "شماره نامعتبر", COMPLETED: "انجام شد", CANCELED: "لغو شد", NO_SHOW: "حضور نداشت", RESCHEDULED: "به زمان دیگری موکول شد", OTHER: "سایر" };
const priorityNames: Record<string, string> = { LOW: "کم", NORMAL: "عادی", HIGH: "زیاد", URGENT: "فوری" };
const taskStatusNames: Record<string, string> = { OPEN: "باز", COMPLETED: "انجام‌شده", CANCELED: "لغوشده" };
const fa = new Intl.NumberFormat("fa-IR");
const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "بدون موعد";
const contextQuery = (context: Context) => new URLSearchParams(Object.fromEntries(Object.entries(context).filter(([key, value]) => key !== "displayName" && Boolean(value)) as [string, string][])).toString();
const localInput = (value?: string | null) => { const date = value ? new Date(value) : new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const isoFromLocal = (value: string) => value ? new Date(value).toISOString() : null;

export function CrmWorkSections({ api, context, canManage }: { api: Api; context: Context; canManage: boolean }) {
  const key = contextQuery(context);
  const [activities, setActivities] = useState<Page<Activity>>({ items: [], total: 0, page: 1, pageSize: 5 });
  const [tasks, setTasks] = useState<Page<Task>>({ items: [], total: 0, page: 1, pageSize: 5 });
  const [notes, setNotes] = useState<Page<Note>>({ items: [], total: 0, page: 1, pageSize: 5 });
  const [composer, setComposer] = useState<Composer | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pageSize = expanded ? 100 : 5;
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const suffix = new URLSearchParams(`${key}${key ? "&" : ""}archiveStatus=${showArchived ? "ALL" : "ACTIVE"}&page=1&pageSize=${pageSize}`).toString();
      const [a, t, n] = await Promise.all([
        api<Page<Activity>>(`/platform/crm/activities?${suffix}&sort=occurredAt&direction=DESC`),
        api<Page<Task>>(`/platform/crm/tasks?${suffix}&sort=dueAt&direction=ASC`),
        api<Page<Note>>(`/platform/crm/notes?${suffix}&sort=createdAt&direction=DESC`),
      ]);
      setActivities(a); setTasks(t); setNotes(n);
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }, [api, key, pageSize, showArchived]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (canManage) void api<UserOption[]>("/platform/crm/leads/assignees").then(setUsers).catch(() => setUsers([])); }, [api, canManage]);

  async function runTask(task: Task, action: "complete" | "cancel" | "reopen" | "archive" | "restore") {
    setBusy(true); setError("");
    try { await api(`/platform/crm/tasks/${task.id}/${action}`, { method: "POST" }); setNotice(action === "complete" ? "وظیفه انجام شد." : action === "cancel" ? "وظیفه لغو شد." : action === "reopen" ? "وظیفه دوباره باز شد." : action === "archive" ? "وظیفه بایگانی شد." : "وظیفه بازیابی شد."); await load(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function archive(path: string, id: string, isArchived: boolean) {
    setBusy(true); setError("");
    try { await api(`/platform/crm/${path}/${id}/${isArchived ? "restore" : "archive"}`, { method: "POST" }); await load(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function save(path: string, method: "POST" | "PATCH", id: string | undefined, body: Record<string, unknown>, after?: () => void) {
    setBusy(true); setError("");
    try {
      await api(`/platform/crm/${path}${id ? `/${id}` : ""}`, { method, body: JSON.stringify(body) });
      setComposer(null); setNotice(path === "activities" ? "فعالیت ثبت شد." : path === "tasks" ? "وظیفه ذخیره شد." : "یادداشت ذخیره شد.");
      after?.(); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  const relationFields = { organizationId: context.organizationId ?? null, contactId: context.contactId ?? null, leadId: context.leadId ?? null, dealId: context.dealId ?? null };

  return <section className="crm-work" id="crm-work" aria-label="فعالیت‌ها، وظایف و یادداشت‌ها">
    <header className="crm-work-heading"><div><h2>کارهای CRM</h2><p>تعامل‌ها، پیگیری‌های باز و یادداشت‌های این رکورد</p></div>
      {canManage && <div className="crm-work-actions"><button type="button" onClick={() => setComposer({ kind: "ACTIVITY" })}>ثبت فعالیت</button><button type="button" className="crm-secondary" onClick={() => setComposer({ kind: "TASK" })}>وظیفه جدید</button><button type="button" className="crm-secondary" onClick={() => setComposer({ kind: "TASK", followUp: true })}>پیگیری</button><button type="button" className="crm-secondary" onClick={() => setComposer({ kind: "NOTE" })}>یادداشت</button></div>}
    </header>
    <label className="crm-work-archived"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> نمایش سوابق بایگانی‌شده</label>
    {notice && <p className="message success" role="status">{notice}</p>}{error && <p className="message error" role="alert">{error} <button type="button" className="crm-secondary" onClick={() => void load()}>تلاش دوباره</button></p>}
    {composer && <section className="crm-work-form-panel" aria-labelledby="crm-work-form-title">
      {composer.kind === "ACTIVITY" && <ActivityForm initial={composer.initial} busy={busy} onCancel={() => setComposer(null)} onSubmit={(body) => void save("activities", composer.initial ? "PATCH" : "POST", composer.initial?.id, { ...body, ...relationFields })} />}
      {composer.kind === "TASK" && <TaskForm initial={composer.initial} followUp={composer.followUp} users={users} context={context} busy={busy} onCancel={() => setComposer(null)} onSubmit={(body) => void save("tasks", composer.initial ? "PATCH" : "POST", composer.initial?.id, { ...body, ...relationFields })} />}
      {composer.kind === "NOTE" && <NoteForm initial={composer.initial} busy={busy} onCancel={() => setComposer(null)} onSubmit={(body) => void save("notes", composer.initial ? "PATCH" : "POST", composer.initial?.id, { ...body, ...relationFields })} />}
    </section>}
    {loading ? <p className="crm-inline-loading" role="status">در حال دریافت کارهای CRM…</p> : <>
      <WorkGroup title="فعالیت‌ها" total={activities.total} onMore={() => setExpanded(true)} hasMore={!expanded && activities.total > activities.items.length}>
        {activities.items.map((item) => <article className={`crm-work-item${item.archivedAt ? " is-archived" : ""}`} key={item.id}>
          <div className="crm-work-item-main"><div className="crm-work-item-title"><span className="crm-work-badge">{activityNames[item.activityType] ?? item.activityType}</span><strong>{item.subject}</strong>{item.outcome && <span className="crm-work-badge">{outcomeNames[item.outcome] ?? item.outcome}</span>}{item.archivedAt && <span className="crm-work-badge">بایگانی‌شده</span>}</div>
            <small>{dateTime(item.occurredAt)}{item.actorLabel ? ` · ${item.actorLabel}` : ""}</small>{item.details && <p>{item.details}</p>}<RelatedLinks item={item} />
          </div>{canManage && <div className="crm-work-item-actions">{item.archivedAt ? <button type="button" disabled={busy} onClick={() => void archive("activities", item.id, true)}>بازیابی</button> : <><button type="button" disabled={busy} onClick={() => setComposer({ kind: "ACTIVITY", initial: item })}>ویرایش</button><button type="button" className="crm-danger" disabled={busy} onClick={() => void archive("activities", item.id, false)}>بایگانی</button></>}</div>}
        </article>)}{!activities.items.length && <p className="crm-work-empty">هنوز فعالیتی برای این رکورد ثبت نشده است.</p>}
      </WorkGroup>
      <WorkGroup title="وظایف و پیگیری‌ها" total={tasks.total} onMore={() => setExpanded(true)} hasMore={!expanded && tasks.total > tasks.items.length}>
        {tasks.items.map((task) => <TaskCard key={task.id} task={task} canManage={canManage} busy={busy} onAction={(action) => void runTask(task, action)} onEdit={() => setComposer({ kind: "TASK", initial: task })} />)}
        {!tasks.items.length && <p className="crm-work-empty">وظیفه بازی برای این رکورد ثبت نشده است.</p>}
      </WorkGroup>
      <WorkGroup title="یادداشت‌ها" total={notes.total} onMore={() => setExpanded(true)} hasMore={!expanded && notes.total > notes.items.length}>
        {notes.items.map((note) => <article className={`crm-work-item${note.archivedAt ? " is-archived" : ""}`} key={note.id}>
          <div className="crm-work-item-main"><div className="crm-work-item-title"><strong>یادداشت</strong>{note.archivedAt && <span className="crm-work-badge">بایگانی‌شده</span>}</div><small>{dateTime(note.createdAt)}{note.authorLabel ? ` · ${note.authorLabel}` : ""}</small><p className="crm-work-note-body">{note.body}</p><RelatedLinks item={note} /></div>
          {canManage && <div className="crm-work-item-actions">{note.archivedAt ? <button type="button" disabled={busy} onClick={() => void archive("notes", note.id, true)}>بازیابی</button> : <><button type="button" disabled={busy} onClick={() => setComposer({ kind: "NOTE", initial: note })}>ویرایش</button><button type="button" className="crm-danger" disabled={busy} onClick={() => void archive("notes", note.id, false)}>بایگانی</button></>}</div>}
        </article>)}{!notes.items.length && <p className="crm-work-empty">هنوز یادداشتی برای این رکورد ثبت نشده است.</p>}
      </WorkGroup>
    </>}
  </section>;
}

function WorkGroup({ title, total, children, hasMore, onMore }: { title: string; total: number; children: React.ReactNode; hasMore: boolean; onMore: () => void }) {
  return <section className="crm-work-group"><header><h3>{title}</h3><span>{fa.format(total)}</span></header><div className="crm-work-list">{children}</div>{hasMore && <button type="button" className="crm-work-more" onClick={onMore}>نمایش موارد بیشتر</button>}</section>;
}

function RelatedLinks({ item }: { item: Related }) {
  const links = [
    item.organizationId && item.organizationName && ["سازمان", `/platform/crm/organizations/${item.organizationId}`, item.organizationName],
    item.contactId && item.contactName && ["ارتباط", `/platform/crm/contacts/${item.contactId}`, item.contactName],
    item.leadId && item.leadName && ["سرنخ", `/platform/crm/leads/${item.leadId}`, item.leadName],
    item.dealId && item.dealTitle && ["فرصت", `/platform/crm/deals/${item.dealId}`, item.dealTitle],
  ].filter(Boolean) as [string, string, string][];
  return links.length ? <p className="crm-work-related">{links.map(([label, href, name], index) => <span key={`${href}-${index}`}>{index ? " · " : "مرتبط: "}<Link href={href}>{label}: {name}</Link></span>)}</p> : null;
}

function TaskCard({ task, canManage, busy, onAction, onEdit, allowArchive = true }: { task: Task; canManage: boolean; busy: boolean; onAction: (action: "complete" | "cancel" | "reopen" | "archive" | "restore") => void; onEdit?: () => void; allowArchive?: boolean }) {
  return <article className={`crm-work-item crm-task-item${task.overdue ? " is-overdue" : ""}${task.archivedAt ? " is-archived" : ""}`}>
    <div className="crm-work-item-main"><div className="crm-work-item-title"><strong>{task.title}</strong><span className="crm-work-badge">{task.kind === "FOLLOW_UP" ? "پیگیری" : "وظیفه"}</span><span className={`crm-work-badge crm-priority-${task.priority.toLowerCase()}`}>اولویت {priorityNames[task.priority] ?? task.priority}</span>{task.overdue && <span className="crm-work-badge crm-overdue-badge">عقب‌افتاده</span>}{task.archivedAt && <span className="crm-work-badge">بایگانی‌شده</span>}</div>
      <small>{taskStatusNames[task.status] ?? task.status} · {task.dueAt ? `موعد ${dateTime(task.dueAt)}` : "بدون موعد"}{task.assigneeLabel ? ` · ${task.assigneeLabel}` : " · بدون مسئول"}</small>{task.description && <p>{task.description}</p>}<RelatedLinks item={task} />
    </div>
    {canManage && <div className="crm-work-item-actions">{task.archivedAt ? <button type="button" disabled={busy} onClick={() => onAction("restore")}>بازیابی</button> : task.status === "OPEN" ? <><button type="button" disabled={busy} onClick={() => onAction("complete")}>انجام شد</button>{onEdit && <button type="button" className="crm-secondary" disabled={busy} onClick={onEdit}>ویرایش</button>}<button type="button" className="crm-danger" disabled={busy} onClick={() => onAction("cancel")}>لغو</button></> : <><button type="button" disabled={busy} onClick={() => onAction("reopen")}>بازکردن دوباره</button>{allowArchive && <button type="button" className="crm-danger" disabled={busy} onClick={() => onAction("archive")}>بایگانی</button>}</>}</div>}
  </article>;
}

function ActivityForm({ initial, busy, onCancel, onSubmit }: { initial?: Activity; busy: boolean; onCancel: () => void; onSubmit: (body: Record<string, unknown>) => void }) {
  const [activityType, setActivityType] = useState(initial?.activityType ?? "CALL");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [details, setDetails] = useState(initial?.details ?? "");
  const [occurredAt, setOccurredAt] = useState(localInput(initial?.occurredAt));
  const [outcome, setOutcome] = useState(initial?.outcome ?? "");
  const options = activityType === "CALL" ? ["CONNECTED", "NO_ANSWER", "BUSY", "CALL_BACK_REQUESTED", "NOT_INTERESTED", "INTERESTED", "INVALID_NUMBER", "OTHER"] : ["COMPLETED", "CANCELED", "NO_SHOW", "RESCHEDULED", "OTHER"];
  const supportsOutcome = ["CALL", "MEETING", "DEMO"].includes(activityType);
  return <form className="crm-work-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit({ activityType, subject, details: details || null, occurredAt: isoFromLocal(occurredAt), outcome: supportsOutcome ? outcome || null : null }); }}>
    <h3 id="crm-work-form-title">{initial ? "ویرایش فعالیت" : "ثبت فعالیت"}</h3>
    <label>نوع تعامل<select required value={activityType} onChange={(event) => { setActivityType(event.target.value); setOutcome(""); }}><option value="CALL">تماس</option><option value="MEETING">جلسه</option><option value="DEMO">نمایش محصول</option><option value="EMAIL">ایمیل</option><option value="SMS">پیامک</option><option value="WHATSAPP">واتس‌اپ</option><option value="OTHER">سایر</option></select></label>
    <label>موضوع<input required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
    <label>زمان وقوع<input required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
    {supportsOutcome && <label>نتیجه<select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="">بدون نتیجه مشخص</option>{options.map((value) => <option key={value} value={value}>{outcomeNames[value]}</option>)}</select></label>}
    <label className="crm-work-wide">توضیحات<textarea maxLength={4000} rows={3} value={details} onChange={(event) => setDetails(event.target.value)} /></label>
    <div className="crm-form-actions"><button disabled={busy}>{busy ? "در حال ذخیره…" : initial ? "ذخیره تغییرات" : "ثبت فعالیت"}</button><button type="button" className="crm-secondary" onClick={onCancel}>انصراف</button></div>
  </form>;
}

function TaskForm({ initial, followUp, users, context, busy, onCancel, onSubmit }: { initial?: Task; followUp?: boolean; users: UserOption[]; context: Context; busy: boolean; onCancel: () => void; onSubmit: (body: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState(initial?.title ?? (followUp ? `پیگیری ${context.displayName ?? "این رکورد"}` : ""));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kind, setKind] = useState(initial?.kind ?? (followUp ? "FOLLOW_UP" : "GENERAL"));
  const [priority, setPriority] = useState(initial?.priority ?? "NORMAL");
  const [dueAt, setDueAt] = useState(initial?.dueAt ? localInput(initial.dueAt) : "");
  const [assignedToUserId, setAssignedToUserId] = useState(initial?.assignedToUserId ?? "");
  return <form className="crm-work-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit({ title, description: description || null, kind, priority, dueAt: isoFromLocal(dueAt), assignedToUserId: assignedToUserId || null }); }}>
    <h3 id="crm-work-form-title">{initial ? "ویرایش وظیفه" : kind === "FOLLOW_UP" ? "ایجاد پیگیری" : "وظیفه جدید"}</h3>
    <label>عنوان<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>موعد اختیاری<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
    <label>نوع<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="GENERAL">وظیفه</option><option value="FOLLOW_UP">پیگیری</option></select></label>
    <label>اولویت<select value={priority} onChange={(event) => setPriority(event.target.value)}>{Object.entries(priorityNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>مسئول<select value={assignedToUserId} onChange={(event) => setAssignedToUserId(event.target.value)}><option value="">بدون مسئول</option>{users.map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}</select></label>
    <label className="crm-work-wide">توضیحات اختیاری<textarea maxLength={4000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="crm-form-actions"><button disabled={busy}>{busy ? "در حال ذخیره…" : initial ? "ذخیره تغییرات" : kind === "FOLLOW_UP" ? "ثبت پیگیری" : "ثبت وظیفه"}</button><button type="button" className="crm-secondary" onClick={onCancel}>انصراف</button></div>
  </form>;
}

function NoteForm({ initial, busy, onCancel, onSubmit }: { initial?: Note; busy: boolean; onCancel: () => void; onSubmit: (body: Record<string, unknown>) => void }) {
  const [body, setBody] = useState(initial?.body ?? "");
  return <form className="crm-work-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit({ body }); }}>
    <h3 id="crm-work-form-title">{initial ? "ویرایش یادداشت" : "یادداشت جدید"}</h3>
    <label className="crm-work-wide">متن یادداشت<textarea required maxLength={8000} rows={4} value={body} onChange={(event) => setBody(event.target.value)} /></label>
    <div className="crm-form-actions"><button disabled={busy}>{busy ? "در حال ذخیره…" : initial ? "ذخیره تغییرات" : "ثبت یادداشت"}</button><button type="button" className="crm-secondary" onClick={onCancel}>انصراف</button></div>
  </form>;
}

type TaskView = "TODAY" | "OVERDUE" | "UPCOMING" | "OPEN" | "COMPLETED";
function todayQuery(view: TaskView) {
  if (view !== "TODAY") return { view };
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { view: "OPEN", dueFrom: start.toISOString(), dueTo: end.toISOString() };
}

export function CrmTasksWorkspace() {
  const { state, access, api } = usePlatformSession();
  if (state === "loading") return <main className="platform-entry"><p>در حال بررسی دسترسی…</p></main>;
  if (state !== "ready" || !access.includes("crm.read")) return <main className="platform-entry"><section><h1>دسترسی CRM فعال نیست</h1><p>برای دیدن وظایف به دسترسی crm.read نیاز دارید.</p><Link className="crm-button" href="/platform">بازگشت به پنل پلتفرم</Link></section></main>;
  return <TaskShell canManage={access.includes("crm.manage")}><TaskDirectory api={api} canManage={access.includes("crm.manage")} /></TaskShell>;
}

function TaskDirectory({ api, canManage }: { api: Api; canManage: boolean }) {
  const [view, setView] = useState<TaskView>("TODAY");
  const [q, setQ] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Task>>({ items: [], total: 0, page: 1, pageSize: 25 });
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const query = useMemo(() => ({ ...todayQuery(view), q, assigneeId, priority, page: String(page), pageSize: "25", archiveStatus: "ACTIVE", sort: "dueAt", direction: "ASC" }), [assigneeId, page, priority, q, view]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const params = new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([, value]) => Boolean(value)) as [string, string][])); setResult(await api<Page<Task>>(`/platform/crm/tasks?${params}`)); }
    catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }, [api, query]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (canManage) void api<UserOption[]>("/platform/crm/leads/assignees").then(setUsers).catch(() => setUsers([])); }, [api, canManage]);
  async function run(task: Task, action: "complete" | "cancel" | "reopen") {
    setBusy(true); setError("");
    try { await api(`/platform/crm/tasks/${task.id}/${action}`, { method: "POST" }); setNotice(action === "complete" ? "وظیفه انجام شد." : action === "cancel" ? "وظیفه لغو شد." : "وظیفه دوباره باز شد."); await load(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  const tabs: [TaskView, string][] = [["TODAY", "امروز"], ["OVERDUE", "عقب‌افتاده"], ["UPCOMING", "پیش‌رو"], ["OPEN", "همه بازها"], ["COMPLETED", "انجام‌شده"]];
  return <>
    <header className="crm-heading"><div><p className="platform-nav-label">CRM / وظایف</p><h1>وظایف و پیگیری‌ها</h1><p>کارهای امروز، موعدهای گذشته و پیگیری‌های بعدی</p></div></header>
    <nav className="crm-task-tabs" aria-label="فیلتر وظایف">{tabs.map(([key, label]) => <button type="button" key={key} aria-pressed={view === key} className={view === key ? "is-active" : ""} onClick={() => { setView(key); setPage(1); }}>{label}</button>)}</nav>
    <div className="crm-task-filters">
      <label>جست‌وجو<input value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} placeholder="عنوان یا رکورد مرتبط" /></label>
      <label>مسئول<select value={assigneeId} onChange={(event) => { setAssigneeId(event.target.value); setPage(1); }}><option value="">همه مسئولان</option><option value="ME">وظایف من</option><option value="UNASSIGNED">بدون مسئول</option>{users.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>اولویت<select value={priority} onChange={(event) => { setPriority(event.target.value); setPage(1); }}><option value="">همه اولویت‌ها</option>{Object.entries(priorityNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    {notice && <p className="message success" role="status">{notice}</p>}{error && <p className="message error" role="alert">{error} <button type="button" className="crm-secondary" onClick={() => void load()}>تلاش دوباره</button></p>}
    {loading ? <p className="empty" role="status">در حال دریافت وظایف…</p> : result.items.length ? <div className="crm-task-directory">{result.items.map((task) => <TaskCard key={task.id} task={task} canManage={canManage} busy={busy} allowArchive={false} onAction={(action) => { if (action === "complete" || action === "cancel" || action === "reopen") void run(task, action); }} />)}</div> : <div className="empty crm-empty"><strong>{view === "TODAY" ? "برای امروز وظیفه‌ای ندارید." : "وظیفه‌ای در این فهرست پیدا نشد."}</strong><p>برای ساخت پیگیری، یک سازمان، سرنخ یا فرصت را باز کنید.</p><Link className="crm-button" href="/platform/crm/leads">رفتن به سرنخ‌ها</Link></div>}
    <nav className="crm-pagination" aria-label="صفحه‌بندی وظایف"><span>مجموع: {fa.format(result.total)}</span><button type="button" className="crm-secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>قبلی</button><span>صفحه {fa.format(page)}</span><button type="button" className="crm-secondary" disabled={loading || page * 25 >= result.total} onClick={() => setPage((value) => value + 1)}>بعدی</button></nav>
  </>;
}

function TaskShell({ children, canManage }: { children: React.ReactNode; canManage: boolean }) {
  return <main className="platform-app crm-app"><div className="platform-frame">
    <aside className="platform-sidebar"><div><div className="platform-brand"><span><strong>CRM یو کافه</strong><small>مدیریت ارتباط‌های تجاری</small></span></div><p className="platform-nav-label">فضای کاری CRM</p><nav aria-label="ناوبری CRM"><Link className="platform-crm-link" href="/platform/crm">سازمان‌ها</Link><Link className="platform-crm-link" href="/platform/crm/leads">سرنخ‌ها</Link><Link className="platform-crm-link" href="/platform/crm/pipeline">خط فروش</Link><Link className="platform-crm-link" href="/platform/crm/deals">فرصت‌ها</Link><Link className="platform-crm-link" href="/platform/crm/segments">بخش‌بندی‌ها</Link><Link className="platform-crm-link" href="/platform/crm/tasks">وظایف</Link>{canManage && <><Link className="platform-crm-link" href="/platform/crm/settings">فیلدها و برچسب‌ها</Link><Link className="platform-crm-link" href="/platform/crm/organizations/new">افزودن سازمان</Link><Link className="platform-crm-link" href="/platform/crm/leads/new">افزودن سرنخ</Link><Link className="platform-crm-link" href="/platform/crm/deals/new">فرصت جدید</Link></>}</nav></div><Link className="crm-back" href="/platform">بازگشت به پلتفرم</Link></aside>
    <section className="platform-shell"><header className="platform-topbar"><strong>مدیریت ارتباط‌های تجاری</strong><Link href="/platform">پنل پلتفرم</Link></header><div className="crm-content">{children}</div><nav className="platform-bottom-nav" aria-label="ناوبری CRM"><Link href="/platform/crm">سازمان‌ها</Link><Link href="/platform/crm/leads">سرنخ‌ها</Link><Link href="/platform/crm/pipeline">خط فروش</Link><Link href="/platform/crm/deals">فرصت‌ها</Link><Link href="/platform/crm/tasks">وظایف</Link></nav></section>
  </div></main>;
}
