"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Note = { id: string; body: string; authorLabel: string; createdAt: string; updatedAt: string };
type Preferences = { preferredSeating: string | null; favoriteDrink: string | null; dietaryNotes: string | null; allergyNotes: string | null; birthdayMonthDay: string | null };
type Tag = { id: string; name: string; archivedAt?: string | null; clientCount?: number };
type Option = { id: string; label: string; active: boolean; sortOrder: number };
type Field = { id: string; key: string; label: string; description: string | null; dataType: string; required: boolean; active: boolean; sortOrder: number; options: Option[]; value: unknown };
type Reminder = { id: string; clientId: string; clientFirstName: string; clientLastName: string; title: string; description: string | null; dueAt: string; status: "OPEN" | "COMPLETED" | "CANCELED"; assignedToUserId: string | null; assigneeLabel: string | null; overdue: boolean; createdAt: string };
type Assignee = { id: string; label: string };
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
const labels: Record<string, string> = { TEXT: "متن کوتاه", LONG_TEXT: "متن بلند", NUMBER: "عدد", BOOLEAN: "بله یا خیر", DATE: "تاریخ", SINGLE_SELECT: "انتخاب یک مورد", MULTI_SELECT: "انتخاب چند مورد", URL: "پیوند" };
const reminderStatus: Record<string, string> = { OPEN: "باز", COMPLETED: "انجام‌شده", CANCELED: "لغوشده" };
const dateTime = (value: string, timeZone: string) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

function ErrorLine({ value, retry }: { value: string; retry: () => void }) {
  return <div className="tenant-crm-inline-error" role="alert"><span>{value}</span><button type="button" onClick={retry}>تلاش دوباره</button></div>;
}

export function TenantCrmRelationshipPanel({ clientId, api, timeZone, canManage }: { clientId: string; api: Api; timeZone: string; canManage: boolean }) {
  const [refresh, setRefresh] = useState(0);
  const [preferences, setPreferences] = useState<Preferences>();
  const [notes, setNotes] = useState<Page<Note>>();
  const [tags, setTags] = useState<Tag[]>([]);
  const [assignedTags, setAssignedTags] = useState<Tag[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [reminders, setReminders] = useState<Page<Reminder>>();
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [newTag, setNewTag] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDescription, setReminderDescription] = useState("");
  const [reminderDueAt, setReminderDueAt] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  useEffect(() => {
    let active = true;
    const base = `/tenant/crm/clients/${encodeURIComponent(clientId)}`;
    const load = async <T,>(key: string, path: string, set: (value: T) => void) => {
      try { const value = await api<T>(path); if (active) set(value); }
      catch (error) { if (active) setErrors((current) => ({ ...current, [key]: (error as Error).message })); }
    };
    setErrors({});
    void load<Preferences>("preferences", `${base}/preferences`, setPreferences);
    void load<Page<Note>>("notes", `${base}/notes?page=1&pageSize=20`, setNotes);
    void load<Tag[]>("tags", "/tenant/crm/tags", setTags);
    void load<Tag[]>("assignedTags", `${base}/tags`, setAssignedTags);
    void load<{ fields: Field[] }>("fields", `${base}/custom-fields`, (value) => { setFields(value.fields); setFieldValues(Object.fromEntries(value.fields.map((field) => [field.key, field.value ?? (field.dataType === "MULTI_SELECT" ? [] : "")]))); });
    const reminderQuery = new URLSearchParams({ view: "ALL", page: "1", pageSize: "25", clientId });
    void load<Page<Reminder>>("reminders", `/tenant/crm/reminders?${reminderQuery}`, setReminders);
    if (canManage) void load<Assignee[]>("assignees", "/tenant/crm/users", setAssignees);
    return () => { active = false; };
  }, [api, canManage, clientId, refresh]);

  const reload = () => setRefresh((value) => value + 1);
  const mutate = async (key: string, task: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(key); setErrors((value) => ({ ...value, [key]: "" })); setNotice("");
    try { await task(); setNotice(success); reload(); return true; }
    catch (error) { setErrors((value) => ({ ...value, [key]: (error as Error).message })); return false; }
    finally { setBusy(""); }
  };
  const submitPreferences = (event: FormEvent) => { event.preventDefault(); if (preferences) void mutate("preferences", () => api(`/tenant/crm/clients/${clientId}/preferences`, json("PATCH", preferences)), "ترجیحات ذخیره شد."); };
  const addNote = (event: FormEvent) => { event.preventDefault(); void mutate("notes", () => api(`/tenant/crm/clients/${clientId}/notes`, json("POST", { body: noteBody })), "یادداشت ثبت شد.").then((saved) => { if (saved) setNoteBody(""); }); };
  const saveNote = (noteId: string) => void mutate("notes", () => api(`/tenant/crm/clients/${clientId}/notes/${noteId}`, json("PATCH", { body: editingBody })), "یادداشت ویرایش شد.").then((saved) => { if (saved) setEditingNote(null); });
  const archiveNote = (noteId: string) => void mutate("notes", () => api(`/tenant/crm/clients/${clientId}/notes/${noteId}`, { method: "DELETE" }), "یادداشت بایگانی شد.");
  const addTag = async (event: FormEvent) => {
    event.preventDefault();
    let tagId = selectedTag;
    if (!tagId && newTag.trim()) {
      try { const tag = await api<Tag>("/tenant/crm/tags", json("POST", { name: newTag })); tagId = tag.id; }
      catch (error) { setErrors((value) => ({ ...value, tags: (error as Error).message })); return; }
    }
    if (!tagId) return;
    await mutate("tags", () => api(`/tenant/crm/clients/${clientId}/tags/${tagId}`, json("POST")), "برچسب افزوده شد.").then((saved) => { if (saved) { setSelectedTag(""); setNewTag(""); } });
  };
  const removeTag = (tagId: string) => void mutate("tags", () => api(`/tenant/crm/clients/${clientId}/tags/${tagId}`, { method: "DELETE" }), "برچسب برداشته شد.");
  const saveFields = (event: FormEvent) => {
    event.preventDefault();
    const values = Object.fromEntries(Object.entries(fieldValues).map(([key, value]) => [key, value === "" ? null : value]));
    void mutate("fields", () => api(`/tenant/crm/clients/${clientId}/custom-fields`, json("PATCH", { values })), "فیلدها ذخیره شدند.");
  };
  const addReminder = (event: FormEvent) => {
    event.preventDefault();
    const dueAt = new Date(reminderDueAt);
    if (Number.isNaN(dueAt.getTime())) { setErrors((value) => ({ ...value, reminders: "زمان یادآوری را وارد کنید." })); return; }
    void mutate("reminders", () => api(`/tenant/crm/clients/${clientId}/reminders`, json("POST", { title: reminderTitle, description: reminderDescription || null, dueAt: dueAt.toISOString(), assignedToUserId: assigneeId || null })), "یادآوری ثبت شد.").then((saved) => { if (saved) { setReminderTitle(""); setReminderDescription(""); setReminderDueAt(""); setAssigneeId(""); } });
  };
  const updateReminder = (reminderId: string, status: "COMPLETED" | "CANCELED") => void mutate("reminders", () => api(`/tenant/crm/reminders/${reminderId}`, json("PATCH", { status })), "یادآوری به‌روز شد.");

  return <>
    {notice && <p className="tenant-crm-success" role="status">{notice}</p>}
    <section className="tenant-crm-section" aria-labelledby="tenant-crm-preferences-title">
      <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-preferences-title">ترجیحات ثبت‌شده</h2><p>اطلاعاتی که کارکنان کافه آگاهانه وارد کرده‌اند.</p></div></div>
      {errors.preferences && <ErrorLine value={errors.preferences} retry={reload} />}
      {preferences ? <form className="tenant-crm-form" onSubmit={submitPreferences}>
        {([ ["preferredSeating", "جای نشستن دلخواه", 80], ["favoriteDrink", "نوشیدنی محبوب", 120], ["dietaryNotes", "ترجیحات غذایی", 500], ["allergyNotes", "یادداشت حساسیت غذایی", 500] ] as const).map(([key, label, max]) => <label key={key}>{label}{key.endsWith("Notes") ? <textarea maxLength={max} disabled={!canManage || !!busy} value={preferences[key] ?? ""} onChange={(event) => setPreferences({ ...preferences, [key]: event.target.value })} /> : <input maxLength={max} disabled={!canManage || !!busy} value={preferences[key] ?? ""} onChange={(event) => setPreferences({ ...preferences, [key]: event.target.value })} />}</label>)}
        <label>روز و ماه تولد <input inputMode="numeric" placeholder="MM-DD" pattern="(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])" disabled={!canManage || !!busy} value={preferences.birthdayMonthDay ?? ""} onChange={(event) => setPreferences({ ...preferences, birthdayMonthDay: event.target.value })} /><small>سال تولد ذخیره نمی‌شود.</small></label>
        {canManage && <button disabled={!!busy} type="submit">ذخیره ترجیحات</button>}
      </form> : <p className="tenant-crm-inline-empty" role="status">در حال دریافت ترجیحات…</p>}
    </section>

    <section className="tenant-crm-section" aria-labelledby="tenant-crm-tags-title">
      <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-tags-title">برچسب‌ها</h2><p>برچسب‌ها فقط برای همین کافه هستند.</p></div></div>
      {errors.tags && <ErrorLine value={errors.tags} retry={reload} />}
      {assignedTags.length ? <ul className="tenant-crm-chips">{assignedTags.map((tag) => <li key={tag.id}><span>{tag.name}</span>{canManage && <button type="button" aria-label={`برداشتن ${tag.name}`} disabled={!!busy} onClick={() => removeTag(tag.id)}>×</button>}</li>)}</ul> : <p className="tenant-crm-inline-empty">هنوز برچسبی ثبت نشده است.</p>}
      {canManage && <form className="tenant-crm-form tenant-crm-tag-form" onSubmit={(event) => void addTag(event)}><label>برچسب موجود<select value={selectedTag} onChange={(event) => { setSelectedTag(event.target.value); setNewTag(""); }}><option value="">انتخاب…</option>{tags.filter((tag) => !assignedTags.some((assigned) => assigned.id === tag.id)).map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select></label><span>یا</span><label>ساخت برچسب جدید<input value={newTag} maxLength={80} onChange={(event) => { setNewTag(event.target.value); setSelectedTag(""); }} /></label><button type="submit" disabled={!!busy || (!selectedTag && !newTag.trim())}>افزودن</button></form>}
    </section>

    <section className="tenant-crm-section" aria-labelledby="tenant-crm-fields-title">
      <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-fields-title">اطلاعات اختصاصی کافه</h2><p>فیلدها بر اساس تعریف مدیر کافه نمایش داده می‌شوند.</p></div>{canManage && <Link href="/admin/crm/fields">مدیریت فیلدها</Link>}</div>
      {errors.fields && <ErrorLine value={errors.fields} retry={reload} />}
      {fields.length ? <form className="tenant-crm-form" onSubmit={saveFields}>{fields.map((field) => <label key={field.id}>{field.label}{field.required && <span aria-label="اجباری"> *</span>}{field.description && <small>{field.description}</small>}{field.dataType === "LONG_TEXT" ? <textarea maxLength={4000} disabled={!canManage || !!busy} value={String(fieldValues[field.key] ?? "")} onChange={(event) => setFieldValues({ ...fieldValues, [field.key]: event.target.value })} />
          : field.dataType === "BOOLEAN" ? <input type="checkbox" disabled={!canManage || !!busy} checked={Boolean(fieldValues[field.key])} onChange={(event) => setFieldValues({ ...fieldValues, [field.key]: event.target.checked })} />
            : field.dataType === "SINGLE_SELECT" ? <select disabled={!canManage || !!busy} value={String(fieldValues[field.key] ?? "")} onChange={(event) => setFieldValues({ ...fieldValues, [field.key]: event.target.value || null })}><option value="">انتخاب…</option>{field.options.filter((option) => option.active).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
              : field.dataType === "MULTI_SELECT" ? <span className="tenant-crm-option-list">{field.options.filter((option) => option.active).map((option) => { const values = Array.isArray(fieldValues[field.key]) ? fieldValues[field.key] as string[] : []; return <span key={option.id}><input type="checkbox" disabled={!canManage || !!busy} checked={values.includes(option.id)} onChange={(event) => setFieldValues({ ...fieldValues, [field.key]: event.target.checked ? [...values, option.id] : values.filter((id) => id !== option.id) })} /> {option.label}</span>; })}</span>
                : <input type={field.dataType === "DATE" ? "date" : field.dataType === "NUMBER" ? "number" : field.dataType === "URL" ? "url" : "text"} maxLength={field.dataType === "URL" ? 2048 : 500} disabled={!canManage || !!busy} value={String(fieldValues[field.key] ?? "")} onChange={(event) => setFieldValues({ ...fieldValues, [field.key]: field.dataType === "NUMBER" && event.target.value !== "" ? Number(event.target.value) : event.target.value })} />}</label>)}{canManage && <button disabled={!!busy} type="submit">ذخیره اطلاعات اختصاصی</button>}</form> : <p className="tenant-crm-inline-empty">فیلد اختصاصی فعالی تعریف نشده است.</p>}
    </section>

    <section className="tenant-crm-section" aria-labelledby="tenant-crm-notes-title">
      <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-notes-title">یادداشت‌های داخلی</h2><p>این یادداشت‌ها برای مشتری قابل مشاهده نیستند.</p></div></div>
      {errors.notes && <ErrorLine value={errors.notes} retry={reload} />}
      {notes ? notes.items.length ? <ul className="tenant-crm-notes">{notes.items.map((note) => <li key={note.id}>{editingNote === note.id ? <><textarea maxLength={4000} value={editingBody} onChange={(event) => setEditingBody(event.target.value)} /><div><button type="button" disabled={!!busy} onClick={() => saveNote(note.id)}>ذخیره</button><button type="button" onClick={() => setEditingNote(null)}>انصراف</button></div></> : <><p>{note.body}</p><small>{note.authorLabel} · {dateTime(note.createdAt, timeZone)}</small>{canManage && <div><button type="button" onClick={() => { setEditingNote(note.id); setEditingBody(note.body); }}>ویرایش</button><button type="button" disabled={!!busy} onClick={() => archiveNote(note.id)}>بایگانی</button></div>}</>}</li>)}</ul> : <p className="tenant-crm-inline-empty">یادداشتی ثبت نشده است.</p> : <p className="tenant-crm-inline-empty" role="status">در حال دریافت یادداشت‌ها…</p>}
      {notes && notes.total > notes.items.length && <button type="button" className="tenant-crm-load-more" disabled={!!busy} onClick={() => void api<Page<Note>>(`/tenant/crm/clients/${clientId}/notes?page=${notes.page + 1}&pageSize=20`).then((next) => setNotes({ ...next, items: [...notes.items, ...next.items] })).catch((error) => setErrors((value) => ({ ...value, notes: (error as Error).message })))}>یادداشت‌های قدیمی‌تر</button>}
      {canManage && <form className="tenant-crm-form" onSubmit={addNote}><label>یادداشت جدید<textarea required minLength={1} maxLength={4000} value={noteBody} onChange={(event) => setNoteBody(event.target.value)} /></label><button disabled={!!busy || !noteBody.trim()} type="submit">ثبت یادداشت</button></form>}
    </section>

    <section className="tenant-crm-section" aria-labelledby="tenant-crm-reminders-title">
      <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-reminders-title">یادآوری‌ها</h2><p>زمان‌ها در {timeZone} نمایش داده می‌شوند.</p></div><Link href="/admin/crm/reminders">همه یادآوری‌ها</Link></div>
      {errors.reminders && <ErrorLine value={errors.reminders} retry={reload} />}
      {reminders ? reminders.items.length ? <ul className="tenant-crm-activity-list">{reminders.items.map((reminder) => <li key={reminder.id}><div><strong>{reminder.title}</strong><span>{dateTime(reminder.dueAt, timeZone)} · {reminderStatus[reminder.status]}{reminder.overdue ? " · سررسید گذشته" : ""}</span>{reminder.description && <span>{reminder.description}</span>}</div>{canManage && reminder.status === "OPEN" && <div><button type="button" disabled={!!busy} onClick={() => updateReminder(reminder.id, "COMPLETED")}>انجام شد</button><button type="button" disabled={!!busy} onClick={() => updateReminder(reminder.id, "CANCELED")}>لغو</button></div>}</li>)}</ul> : <p className="tenant-crm-inline-empty">یادآوری بازی ثبت نشده است.</p> : <p className="tenant-crm-inline-empty" role="status">در حال دریافت یادآوری‌ها…</p>}
      {canManage && <form className="tenant-crm-form" onSubmit={addReminder}><label>عنوان<input required maxLength={200} value={reminderTitle} onChange={(event) => setReminderTitle(event.target.value)} /></label><label>زمان سررسید<input required type="datetime-local" value={reminderDueAt} onChange={(event) => setReminderDueAt(event.target.value)} /><small>زمان ورودی به وقت دستگاه است.</small></label><label>مسئول اختیاری<select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">بدون مسئول</option>{assignees.map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}</select></label><label>توضیح اختیاری<textarea maxLength={4000} value={reminderDescription} onChange={(event) => setReminderDescription(event.target.value)} /></label><button disabled={!!busy} type="submit">ثبت یادآوری</button></form>}
    </section>
  </>;
}

export function TenantCrmFieldManagement() {
  return <FieldManagement />;
}

function FieldManagement() {
  const { api, access } = useAdminSession();
  const canManage = access.permissions.includes("tenant_crm.manage");
  const entitled = access.features?.tenant_crm === true;
  const [fields, setFields] = useState<Field[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagName, setTagName] = useState("");
  const [editingTag, setEditingTag] = useState("");
  const [editingTagName, setEditingTagName] = useState("");
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ key: "", label: "", description: "", dataType: "TEXT", required: false, sortOrder: "0", options: "" });
  const [edit, setEdit] = useState({ label: "", description: "", required: false, active: true, sortOrder: "0", options: [] as Array<{ id?: string; label: string; active?: boolean }> });
  const load = async () => { try { const [nextFields, nextTags] = await Promise.all([api<Field[]>("/tenant/crm/custom-fields?includeInactive=true"), api<Tag[]>("/tenant/crm/tags?includeArchived=true")]); setFields(nextFields); setTags(nextTags); setError(""); } catch (reason) { setError((reason as Error).message); } };
  useEffect(() => { if (entitled && access.permissions.includes("tenant_crm.read")) void load(); }, [api, entitled]);
  useEffect(() => { const field = fields.find((item) => item.id === selected); if (field) setEdit({ label: field.label, description: field.description ?? "", required: field.required, active: field.active, sortOrder: String(field.sortOrder), options: field.options.filter((option) => option.active).map(({ id, label }) => ({ id, label, active: true })) }); }, [fields, selected]);
  if (!access.permissions.includes("tenant_crm.read")) return <section className="tenant-crm-state"><h1>دسترسی محدود</h1><p>نقش شما اجازه مشاهده CRM را ندارد.</p></section>;
  if (!entitled) return <section className="tenant-crm-state"><h1>CRM مشتریان</h1><p>این قابلیت در اشتراک فعلی فعال نیست.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const options = draft.options.split("\n").map((label) => label.trim()).filter(Boolean).map((label) => ({ label }));
    try { await api("/tenant/crm/custom-fields", json("POST", { key: draft.key, label: draft.label, description: draft.description || null, dataType: draft.dataType, required: draft.required, sortOrder: Number(draft.sortOrder), options })); setNotice("فیلد ساخته شد."); setDraft({ key: "", label: "", description: "", dataType: "TEXT", required: false, sortOrder: "0", options: "" }); await load(); }
    catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!selected) return; setBusy(true); setError(""); setNotice("");
    try { await api(`/tenant/crm/custom-fields/${selected}`, json("PATCH", { label: edit.label, description: edit.description || null, required: edit.required, active: edit.active, sortOrder: Number(edit.sortOrder), options: edit.options })); setNotice("فیلد به‌روز شد."); await load(); }
    catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  };
  const createTag = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { await api("/tenant/crm/tags", json("POST", { name: tagName })); setTagName(""); setNotice("برچسب ساخته شد."); await load(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } };
  const saveTag = async (tagId: string) => { setBusy(true); setError(""); try { await api(`/tenant/crm/tags/${tagId}`, json("PATCH", { name: editingTagName })); setEditingTag(""); setNotice("برچسب به‌روز شد."); await load(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } };
  const archiveTag = async (tagId: string) => { setBusy(true); setError(""); try { await api(`/tenant/crm/tags/${tagId}`, { method: "DELETE" }); setNotice("برچسب بایگانی شد."); await load(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } };
  return <section className="tenant-crm" dir="rtl"><Link href="/admin/crm" className="tenant-crm-back">بازگشت به CRM مشتریان</Link><header className="tenant-crm-heading"><div><p className="eyebrow">مدیریت کافه</p><h1>فیلدهای اختصاصی مشتری</h1><p>کلید و نوع فیلد پس از ساخت ثابت می‌مانند.</p></div></header>{error && <p className="tenant-crm-inline-error" role="alert">{error}</p>}{notice && <p className="tenant-crm-success" role="status">{notice}</p>}
    {canManage && <section className="tenant-crm-section"><h2>ساخت فیلد</h2><form className="tenant-crm-form" onSubmit={(event) => void submit(event)}><label>کلید پایدار<input required pattern="[a-z][a-z0-9_]{0,63}" maxLength={64} value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} /></label><label>عنوان نمایشی<input required maxLength={120} value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label><label>نوع<select value={draft.dataType} onChange={(event) => setDraft({ ...draft, dataType: event.target.value })}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>توضیح<input maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label>ترتیب<input type="number" min={0} max={10000} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} /></label><label className="tenant-crm-check"><input type="checkbox" checked={draft.required} onChange={(event) => setDraft({ ...draft, required: event.target.checked })} /> اجباری</label>{["SINGLE_SELECT", "MULTI_SELECT"].includes(draft.dataType) && <label>گزینه‌ها، هر گزینه در یک خط<textarea required value={draft.options} onChange={(event) => setDraft({ ...draft, options: event.target.value })} /></label>}<button disabled={busy || !canManage}>ساخت فیلد</button></form></section>}
    <section className="tenant-crm-section"><h2>برچسب‌های کافه</h2>{canManage && <form className="tenant-crm-form tenant-crm-tag-form" onSubmit={(event) => void createTag(event)}><label>نام برچسب<input required maxLength={80} value={tagName} onChange={(event) => setTagName(event.target.value)} /></label><button disabled={busy}>ساخت برچسب</button></form>}<ul className="tenant-crm-field-list">{tags.map((tag) => <li key={tag.id}>{editingTag === tag.id ? <><input aria-label="نام برچسب" maxLength={80} value={editingTagName} onChange={(event) => setEditingTagName(event.target.value)} /><button type="button" disabled={busy} onClick={() => void saveTag(tag.id)}>ذخیره</button><button type="button" onClick={() => setEditingTag("")}>انصراف</button></> : <><strong>{tag.name}</strong><span>{tag.clientCount ?? 0} مشتری{tag.archivedAt ? " · بایگانی‌شده" : ""}</span>{canManage && !tag.archivedAt && <div><button type="button" onClick={() => { setEditingTag(tag.id); setEditingTagName(tag.name); }}>تغییر نام</button><button type="button" disabled={busy} onClick={() => void archiveTag(tag.id)}>بایگانی</button></div>}</>}</li>)}</ul>{!tags.length && <p className="tenant-crm-inline-empty">برچسبی ساخته نشده است.</p>}</section>
    <section className="tenant-crm-section"><h2>فیلدهای موجود</h2>{fields.length ? <ul className="tenant-crm-field-list">{fields.map((field) => <li key={field.id}><button type="button" aria-pressed={selected === field.id} onClick={() => setSelected(field.id)}><strong>{field.label}</strong><span>{field.key} · {labels[field.dataType] ?? field.dataType}{field.active ? "" : " · بایگانی‌شده"}</span></button></li>)}</ul> : <p className="tenant-crm-inline-empty">فیلدی تعریف نشده است.</p>}{selected && edit && <form className="tenant-crm-form" onSubmit={(event) => void save(event)}><label>عنوان نمایشی<input value={edit.label} maxLength={120} disabled={!canManage} onChange={(event) => setEdit({ ...edit, label: event.target.value })} /></label><label>توضیح<input value={edit.description} maxLength={500} disabled={!canManage} onChange={(event) => setEdit({ ...edit, description: event.target.value })} /></label><label>ترتیب<input type="number" min={0} max={10000} value={edit.sortOrder} disabled={!canManage} onChange={(event) => setEdit({ ...edit, sortOrder: event.target.value })} /></label><label className="tenant-crm-check"><input type="checkbox" checked={edit.required} disabled={!canManage} onChange={(event) => setEdit({ ...edit, required: event.target.checked })} /> اجباری</label><label className="tenant-crm-check"><input type="checkbox" checked={edit.active} disabled={!canManage} onChange={(event) => setEdit({ ...edit, active: event.target.checked })} /> فعال</label>{edit.options.length > 0 && <fieldset><legend>گزینه‌ها</legend>{edit.options.map((option, index) => <label key={option.id ?? index}>{option.label}<input value={option.label} maxLength={120} disabled={!canManage} onChange={(event) => setEdit({ ...edit, options: edit.options.map((value, optionIndex) => optionIndex === index ? { ...value, label: event.target.value } : value) })} /></label>)}<label>افزودن گزینه<input maxLength={120} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const input = event.currentTarget; if (input.value.trim()) setEdit({ ...edit, options: [...edit.options, { label: input.value.trim(), active: true }] }); input.value = ""; } }} /><small>پس از نوشتن، Enter را بزنید.</small></label></fieldset>}{canManage && <button disabled={busy}>ذخیره تغییرها</button>}</form>}</section>
  </section>;
}

export function TenantCrmReminderManagement() {
  const { api, access } = useAdminSession();
  const [view, setView] = useState("TODAY");
  const [page, setPage] = useState<Page<Reminder>>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState("");
  const canRead = access.permissions.includes("tenant_crm.read");
  const canManage = access.permissions.includes("tenant_crm.manage");
  const entitled = access.features?.tenant_crm === true;
  useEffect(() => {
    if (!canRead || !entitled) return;
    let active = true;
    api<Page<Reminder>>(`/tenant/crm/reminders?view=${view}&page=1&pageSize=50`)
      .then((value) => { if (active) { setPage(value); setError(""); } })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [api, canRead, entitled, refresh, view]);
  const update = async (reminderId: string, status: "COMPLETED" | "CANCELED") => {
    setBusy(reminderId); setNotice(""); setError("");
    try { await api(`/tenant/crm/reminders/${reminderId}`, json("PATCH", { status })); setNotice("یادآوری به‌روز شد."); setRefresh((value) => value + 1); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(""); }
  };
  if (!canRead) return <section className="tenant-crm-state"><h1>دسترسی محدود</h1><p>نقش شما اجازه مشاهده CRM را ندارد.</p></section>;
  if (!entitled) return <section className="tenant-crm-state"><h1>CRM مشتریان</h1><p>این قابلیت در اشتراک فعلی فعال نیست.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;
  const views: Array<[string, string]> = [["TODAY", "امروز"], ["OVERDUE", "سررسید گذشته"], ["UPCOMING", "آینده"], ["COMPLETED", "انجام‌شده"], ["CANCELED", "لغوشده"], ["ALL", "همه"]];
  return <section className="tenant-crm" dir="rtl">
    <Link href="/admin/crm" className="tenant-crm-back">بازگشت به CRM مشتریان</Link>
    <header className="tenant-crm-heading"><div><p className="eyebrow">مدیریت کافه · {access.tenant.timezone}</p><h1>یادآوری‌های مشتریان</h1><p>یادآوری‌های دستی مشتریان این کافه</p></div></header>
    <nav className="tenant-crm-tabs" aria-label="فیلتر یادآوری‌ها">{views.map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => { setView(key); setPage(undefined); }}>{label}</button>)}</nav>
    {error && <ErrorLine value={error} retry={() => setRefresh((value) => value + 1)} />}{notice && <p className="tenant-crm-success" role="status">{notice}</p>}
    {page ? page.items.length ? <ul className="tenant-crm-reminder-list">{page.items.map((reminder) => <li key={reminder.id}><div><strong>{reminder.title}</strong><span>{reminder.clientFirstName} {reminder.clientLastName} · {dateTime(reminder.dueAt, access.tenant.timezone)} · {reminderStatus[reminder.status]}{reminder.overdue ? " · سررسید گذشته" : ""}</span>{reminder.description && <p>{reminder.description}</p>}{reminder.assigneeLabel && <small>مسئول: {reminder.assigneeLabel}</small>}</div><div><Link href={`/admin/crm/clients/${reminder.clientId}`}>نمایش مشتری</Link>{canManage && reminder.status === "OPEN" && <><button type="button" disabled={!!busy} onClick={() => void update(reminder.id, "COMPLETED")}>انجام شد</button><button type="button" disabled={!!busy} onClick={() => void update(reminder.id, "CANCELED")}>لغو</button></>}</div></li>)}</ul> : <p className="tenant-crm-empty">در این بازه یادآوری‌ای پیدا نشد.</p> : <p className="tenant-crm-message" role="status">در حال دریافت یادآوری‌ها…</p>}
    {page && page.total > page.items.length && <button className="tenant-crm-load-more" type="button" disabled={!!busy} onClick={() => api<Page<Reminder>>(`/tenant/crm/reminders?view=${view}&page=${page.page + 1}&pageSize=50`).then((next) => setPage({ ...next, items: [...page.items, ...next.items] })).catch((reason: Error) => setError(reason.message))}>نمایش یادآوری‌های بیشتر</button>}
  </section>;
}
