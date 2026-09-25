"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";

type Segment = { id: string; name: string; description: string | null; isActive: boolean; archived: boolean; memberCount: number };
type Customer = { id: string; firstName: string; lastName: string; phone: string; createdAt: string; memberSince?: string };
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type SegmentForm = { id?: string; name: string; description: string; isActive: boolean };
const emptyForm = (): SegmentForm => ({ name: "", description: "", isActive: true });
const number = new Intl.NumberFormat("fa-IR");

export function CustomerSegmentsAdmin() {
  const { access, api } = useAdminSession();
  const canRead = access.permissions.includes("menu.read") || access.permissions.includes("menu.manage");
  const canManage = access.permissions.includes("menu.manage");
  const canReadCustomers = access.permissions.includes("orders.read") || access.permissions.includes("orders.manage");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<SegmentForm | null>(null);
  const [queryText, setQueryText] = useState("");
  const [query, setQuery] = useState("");
  const [membersPage, setMembersPage] = useState<Page<Customer> | null>(null);
  const [clientsPage, setClientsPage] = useState<Page<Customer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = segments.find((segment) => segment.id === selectedId) ?? null;

  const loadSegments = useCallback(async () => {
    const rows = await api<Segment[]>("/tenant/customer-segments");
    setSegments(rows);
    if (!selectedId && rows[0]) setSelectedId(rows[0].id);
  }, [api, selectedId]);

  const loadPeople = useCallback(async () => {
    if (!selectedId || selected?.archived) { setMembersPage(null); setClientsPage(null); return; }
    const search = query ? `&q=${encodeURIComponent(query)}` : "";
    const [members, clients] = await Promise.all([
      api<Page<Customer>>(`/tenant/customer-segments/${selectedId}/members?page=1&pageSize=50${search}`),
      canReadCustomers ? api<Page<Customer>>(`/tenant/customer-segments/clients?page=1&pageSize=50${search}`) : Promise.resolve(null),
    ]);
    setMembersPage(members);
    setClientsPage(clients);
  }, [api, canReadCustomers, query, selected?.archived, selectedId]);

  useEffect(() => {
    if (!canRead) { setLoading(false); return; }
    loadSegments().catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, [canRead, loadSegments]);

  useEffect(() => {
    let current = true;
    loadPeople().catch((reason: Error) => { if (current) setError(reason.message); });
    return () => { current = false; };
  }, [loadPeople]);

  function edit(segment?: Segment) {
    setError(""); setNotice("");
    setForm(segment ? { id: segment.id, name: segment.name, description: segment.description ?? "", isActive: segment.isActive } : emptyForm());
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<Segment>(form.id ? `/tenant/customer-segments/${form.id}` : "/tenant/customer-segments", {
        method: form.id ? "PATCH" : "POST",
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim() || null, ...(form.id ? { isActive: form.isActive } : {}) }),
      });
      await loadSegments();
      if (!form.id) setSelectedId(result.id);
      setForm(null); setNotice(form.id ? "گروه مشتریان به‌روزرسانی شد." : "گروه مشتریان ساخته شد.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function archive(segment: Segment) {
    if (!confirm(`گروه «${segment.name}» بایگانی شود؟ تخفیف‌های وابسته دیگر برای اعضای آن اعمال نمی‌شوند.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/tenant/customer-segments/${segment.id}`, { method: "DELETE" });
      await loadSegments(); setNotice("گروه بایگانی شد.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function changeActive(segment: Segment) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/tenant/customer-segments/${segment.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !segment.isActive }) });
      await loadSegments(); setNotice(segment.isActive ? "گروه غیرفعال شد؛ تخفیف‌های وابسته دیگر اعمال نمی‌شوند." : "گروه فعال شد.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function membership(segmentId: string, clientId: string, add: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(add ? `/tenant/customer-segments/${segmentId}/members` : `/tenant/customer-segments/${segmentId}/members/${clientId}`, {
        method: add ? "POST" : "DELETE", ...(add ? { body: JSON.stringify({ clientId }) } : {}),
      });
      await Promise.all([loadSegments(), loadPeople()]);
      setNotice(add ? "مشتری به گروه اضافه شد." : "مشتری از گروه حذف شد.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function search(event: FormEvent) { event.preventDefault(); setQuery(queryText.trim()); }

  if (!canRead) return <section className="admin-section-state"><p className="eyebrow">دسترسی محدود</p><h1>گروه‌های مشتریان</h1><p>نقش شما اجازه مشاهده این بخش را ندارد.</p></section>;

  return <section className="customer-segments" aria-labelledby="segments-title">
    <header className="admin-page-heading"><div><p className="eyebrow">مشتریان و تخفیف‌ها</p><h1 id="segments-title">گروه‌های مشتریان</h1><p>گروه‌های دستی همین کافه را برای شرط تخفیف بسازید و اعضا را مدیریت کنید.</p></div><div className="promotion-form-actions"><Link className="promotion-secondary" href="/admin/promotions">بازگشت به تخفیف‌ها</Link>{canManage && <button type="button" onClick={() => edit()}>گروه جدید</button>}</div></header>
    {error && <p className="admin-message error" role="alert">{error}</p>}{notice && <p className="admin-message success" role="status">{notice}</p>}
    {form && <form className="promotion-form customer-segment-form" onSubmit={(event) => void save(event)}><div className="promotion-form-heading"><div><h2>{form.id ? "ویرایش گروه" : "گروه جدید"}</h2><p>گروه فقط در همین کافه قابل استفاده است.</p></div><button type="button" className="promotion-cancel" onClick={() => setForm(null)}>بستن</button></div><div className="promotion-form-grid"><label>نام گروه<input value={form.name} maxLength={100} required onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label className="promotion-wide">توضیحات<textarea maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>{form.id && <label className="promotion-activate"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />گروه فعال باشد</label>}</div><div className="promotion-form-actions"><button disabled={busy || !canManage || !form.name.trim()}>{busy ? "در حال ذخیره…" : "ذخیره گروه"}</button><button type="button" className="promotion-cancel" onClick={() => setForm(null)}>انصراف</button></div></form>}
    <div className="customer-segment-layout">
      <section className="customer-segment-list" aria-label="فهرست گروه‌ها"><h2>گروه‌ها</h2>{loading ? <p role="status">در حال دریافت گروه‌ها…</p> : segments.length ? segments.map((segment) => <article key={segment.id} className={`customer-segment-card${selectedId === segment.id ? " selected" : ""}`}><button type="button" className="customer-segment-select" onClick={() => setSelectedId(segment.id)}><strong>{segment.name}</strong><span>{number.format(segment.memberCount)} عضو</span><small>{segment.archived ? "بایگانی‌شده" : segment.isActive ? "فعال" : "غیرفعال"}</small></button>{canManage && !segment.archived && <div className="customer-segment-actions"><button type="button" className="promotion-secondary" disabled={busy} onClick={() => edit(segment)}>ویرایش</button><button type="button" className="promotion-secondary" disabled={busy} onClick={() => void changeActive(segment)}>{segment.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}</button><button type="button" className="promotion-danger" disabled={busy} onClick={() => void archive(segment)}>بایگانی</button></div>}</article>) : <p className="admin-empty">هنوز گروهی نساخته‌اید.</p>}</section>
      <section className="customer-segment-members" aria-labelledby="segment-members-title">{selected ? <><div className="customer-segment-members-heading"><div><h2 id="segment-members-title">اعضای «{selected.name}»</h2><p>{selected.archived ? "این گروه بایگانی شده و در تخفیف‌ها اعمال نمی‌شود." : selected.isActive ? "اعضای گروه در لحظه سفارش دوباره بررسی می‌شوند." : "این گروه غیرفعال است و در تخفیف‌ها اعمال نمی‌شود."}</p></div></div><form className="customer-segment-search" onSubmit={search}><label>جست‌وجوی مشتری<input value={queryText} maxLength={100} onChange={(event) => setQueryText(event.target.value)} placeholder="نام یا شماره موبایل" /></label><button type="submit">جست‌وجو</button></form>
        {!selected.archived && <><h3>اعضا ({number.format(membersPage?.total ?? selected.memberCount)})</h3>{membersPage?.items.length ? <ul>{membersPage.items.map((member) => <li key={member.id}><span><strong>{member.firstName} {member.lastName}</strong><small>{member.phone}</small></span>{canManage && <button type="button" className="promotion-danger" disabled={busy} onClick={() => void membership(selected.id, member.id, false)}>حذف از گروه</button>}</li>)}</ul> : <p className="customer-segment-empty">{membersPage ? "مشتری‌ای در این گروه پیدا نشد." : "در حال دریافت اعضا…"}</p>}
          {membersPage && membersPage.total > membersPage.pageSize && <div className="customer-segment-pages"><button type="button" className="promotion-secondary" disabled={membersPage.page <= 1} onClick={() => void api<Page<Customer>>(`/tenant/customer-segments/${selected.id}/members?page=${membersPage.page - 1}&pageSize=50${query ? `&q=${encodeURIComponent(query)}` : ""}`).then(setMembersPage)}>قبلی</button><span>{number.format(membersPage.page)} / {number.format(Math.ceil(membersPage.total / membersPage.pageSize))}</span><button type="button" className="promotion-secondary" disabled={membersPage.page * membersPage.pageSize >= membersPage.total} onClick={() => void api<Page<Customer>>(`/tenant/customer-segments/${selected.id}/members?page=${membersPage.page + 1}&pageSize=50${query ? `&q=${encodeURIComponent(query)}` : ""}`).then(setMembersPage)}>بعدی</button></div>}
          <h3>افزودن مشتری</h3>{!canReadCustomers ? <p className="customer-segment-empty">برای جست‌وجوی مشتریان به دسترسی مشاهده سفارش‌ها نیاز دارید.</p> : clientsPage?.items.length ? <ul>{clientsPage.items.filter((client) => !membersPage?.items.some((member) => member.id === client.id)).map((client) => <li key={client.id}><span><strong>{client.firstName} {client.lastName}</strong><small>{client.phone}</small></span><button type="button" disabled={busy || !canManage || !selected.isActive} onClick={() => void membership(selected.id, client.id, true)}>افزودن</button></li>)}</ul> : <p className="customer-segment-empty">{clientsPage ? "مشتری دیگری با این جست‌وجو پیدا نشد." : "در حال دریافت مشتریان…"}</p>}
          {clientsPage && clientsPage.total > clientsPage.pageSize && <div className="customer-segment-pages"><button type="button" className="promotion-secondary" disabled={clientsPage.page <= 1} onClick={() => void api<Page<Customer>>(`/tenant/customer-segments/clients?page=${clientsPage.page - 1}&pageSize=50${query ? `&q=${encodeURIComponent(query)}` : ""}`).then(setClientsPage)}>قبلی</button><span>{number.format(clientsPage.page)} / {number.format(Math.ceil(clientsPage.total / clientsPage.pageSize))}</span><button type="button" className="promotion-secondary" disabled={clientsPage.page * clientsPage.pageSize >= clientsPage.total} onClick={() => void api<Page<Customer>>(`/tenant/customer-segments/clients?page=${clientsPage.page + 1}&pageSize=50${query ? `&q=${encodeURIComponent(query)}` : ""}`).then(setClientsPage)}>بعدی</button></div>}
        </>}
      </> : <div className="admin-empty"><strong>گروهی انتخاب نشده</strong><p>برای مدیریت اعضا، یک گروه را انتخاب کنید.</p></div>}</section>
    </div>
  </section>;
}
