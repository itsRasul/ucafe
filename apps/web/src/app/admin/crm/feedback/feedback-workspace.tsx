"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { TenantPermission, useAdminSession } from "../../admin-session";

type ClientRow = { id: string; firstName: string; lastName: string; phone: string };
type FeedbackRow = {
  id: string; clientId: string; clientFirstName: string; clientLastName: string; phone: string; rating: number; comment: string | null;
  source: "MANUAL" | "CUSTOMER_PANEL"; status: "NEW" | "NEEDS_ATTENTION" | "RESOLVED"; orderId: string | null; orderDisplayNumber: string | null;
  reservationId: string | null; reservationDate: string | null; reservationStartTime: string | null; createdAt: string;
};
type FeedbackPage = { items: FeedbackRow[]; total: number; page: number; pageSize: number };

const number = new Intl.NumberFormat("fa-IR");
const dateTime = (value: string) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const sourceLabel = (source: FeedbackRow["source"]) => source === "MANUAL" ? "ثبت توسط کافه" : "ثبت توسط مشتری";
const statusLabel = (status: FeedbackRow["status"]) => ({ NEW: "جدید", NEEDS_ATTENTION: "نیازمند پیگیری", RESOLVED: "رسیدگی‌شده" })[status];

export function FeedbackWorkspace({ initialClientId }: { initialClientId?: string }) {
  const { access, api } = useAdminSession();
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState("");
  const [rating, setRating] = useState("");
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [result, setResult] = useState<FeedbackPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null);
  const [clientError, setClientError] = useState("");
  const [ratingDraft, setRatingDraft] = useState("5");
  const [commentDraft, setCommentDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const permitted = access.permissions.includes("tenant_crm.read" as TenantPermission);
  const canManage = access.permissions.includes("tenant_crm.manage" as TenantPermission);
  const entitled = access.features?.tenant_crm === true;

  useEffect(() => {
    if (!permitted || !entitled) return;
    let active = true;
    setLoading(true); setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: "20", sortBy: "createdAt", sortOrder: "desc" });
    if (initialClientId) params.set("clientId", initialClientId);
    if (query.trim()) params.set("q", query.trim());
    if (status) params.set("status", status);
    if (rating) params.set("rating", rating);
    if (source) params.set("source", source);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    const timer = setTimeout(() => {
      api<FeedbackPage>(`/tenant/crm/feedback?${params}`).then((value) => { if (active) setResult(value); })
        .catch((reason: Error) => { if (active) setError(reason.message); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [api, dateFrom, dateTo, entitled, initialClientId, page, permitted, query, rating, refresh, source, status]);

  async function findClients(event: FormEvent) {
    event.preventDefault(); setClientError("");
    try {
      const params = new URLSearchParams({ q: clientSearch.trim(), page: "1", pageSize: "10" });
      setClients((await api<{ items: ClientRow[] }>(`/tenant/crm/clients?${params}`)).items);
    } catch (reason) { setClientError((reason as Error).message); }
  }

  async function createManualFeedback(event: FormEvent) {
    event.preventDefault();
    if (!selectedClient || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await api("/tenant/crm/feedback", { method: "POST", body: JSON.stringify({ clientId: selectedClient.id, rating: Number(ratingDraft), comment: commentDraft }) });
      setCommentDraft(""); setNotice("بازخورد ثبت شد."); setRefresh((value) => value + 1);
    } catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  }

  if (!permitted) return <section className="tenant-crm-state"><h1>بازخورد مشتریان</h1><p>نقش شما اجازه مشاهده بازخوردها را ندارد.</p></section>;
  if (!entitled) return <section className="tenant-crm-state"><h1>بازخورد مشتریان</h1><p>مدیریت مشتریان در اشتراک فعلی فعال نیست.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / 20));

  return <section className="tenant-crm tenant-feedback-workspace" dir="rtl" aria-busy={loading}>
    <header className="tenant-crm-heading"><div><p className="eyebrow">مدیریت ارتباط با مشتری</p><h1>بازخورد مشتریان</h1><p>ثبت تجربه مشتری و پیگیری موارد نیازمند رسیدگی</p></div><div className="tenant-crm-heading-actions"><Link href="/admin/crm">فهرست مشتریان</Link><span className="tenant-crm-count">{number.format(result?.total ?? 0)} بازخورد</span></div></header>
    {canManage && <details className="tenant-crm-section tenant-feedback-create"><summary>ثبت بازخوردی که حضوری یا تلفنی دریافت شده</summary>
      <div className="tenant-feedback-create-content">
        {!selectedClient ? <><form className="tenant-feedback-client-search" onSubmit={(event) => void findClients(event)}><label htmlFor="feedback-client-search">جست‌وجوی مشتری<input id="feedback-client-search" type="search" value={clientSearch} maxLength={100} onChange={(event) => setClientSearch(event.target.value)} placeholder="نام یا شماره موبایل" required /></label><button type="submit">جست‌وجو</button></form>
          {clientError && <p className="tenant-feedback-error" role="alert">{clientError}</p>}
          {clients.length > 0 && <ul className="tenant-feedback-client-options">{clients.map((client) => <li key={client.id}><button type="button" onClick={() => { setSelectedClient(client); setClients([]); }}><strong>{client.firstName} {client.lastName}</strong><span dir="ltr">{client.phone}</span></button></li>)}</ul>}
        </> : <form className="tenant-feedback-manual-form" onSubmit={(event) => void createManualFeedback(event)}>
          <div className="tenant-feedback-selected-client"><span>بازخورد برای</span><strong>{selectedClient.firstName} {selectedClient.lastName}</strong><button type="button" onClick={() => setSelectedClient(null)}>تغییر مشتری</button></div>
          <label htmlFor="feedback-rating">امتیاز از ۱ تا ۵<select id="feedback-rating" value={ratingDraft} onChange={(event) => setRatingDraft(event.target.value)}>{[5,4,3,2,1].map((value) => <option key={value} value={value}>{number.format(value)} — {"★".repeat(value)}</option>)}</select></label>
          <label htmlFor="feedback-comment">نظر مشتری (اختیاری)<textarea id="feedback-comment" value={commentDraft} maxLength={4000} rows={4} onChange={(event) => setCommentDraft(event.target.value)} /></label>
          <button type="submit" disabled={saving}>{saving ? "در حال ثبت…" : "ثبت بازخورد"}</button>
        </form>}
      </div>
    </details>}
    {notice && <p className="tenant-feedback-success" role="status">{notice}</p>}
    {error && <div className="tenant-crm-message" role="alert"><p>{error}</p><button type="button" onClick={() => { setError(""); setRefresh((value) => value + 1); }}>تلاش دوباره</button></div>}
    <div className="tenant-feedback-filters">
      <label htmlFor="feedback-q">جست‌وجو<input id="feedback-q" type="search" value={query} maxLength={100} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="نام مشتری یا متن بازخورد" /></label>
      <label htmlFor="feedback-status">وضعیت<select id="feedback-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">همه وضعیت‌ها</option><option value="NEW">جدید</option><option value="NEEDS_ATTENTION">نیازمند پیگیری</option><option value="RESOLVED">رسیدگی‌شده</option></select></label>
      <label htmlFor="feedback-rating-filter">امتیاز<select id="feedback-rating-filter" value={rating} onChange={(event) => { setRating(event.target.value); setPage(1); }}><option value="">همه امتیازها</option>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{number.format(value)} ستاره</option>)}</select></label>
      <label htmlFor="feedback-source">منبع<select id="feedback-source" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}><option value="">همه منابع</option><option value="CUSTOMER_PANEL">پنل مشتری</option><option value="MANUAL">ثبت کافه</option></select></label>
      <label htmlFor="feedback-date-from">از تاریخ<input id="feedback-date-from" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} /></label>
      <label htmlFor="feedback-date-to">تا تاریخ<input id="feedback-date-to" type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} /></label>
    </div>
    {loading && !result ? <p className="tenant-crm-message" role="status">در حال دریافت بازخوردها…</p>
      : result?.items.length ? <>
        {loading && <p className="tenant-crm-loading" role="status">در حال به‌روزرسانی فهرست…</p>}
        <ul className="tenant-feedback-list">{result.items.map((item) => <li key={item.id}><Link href={`/admin/crm/feedback/${item.id}`} className="tenant-feedback-card">
          <span className="tenant-feedback-card-main"><strong>{item.clientFirstName} {item.clientLastName}</strong><span className="tenant-feedback-stars" aria-label={`${item.rating} از ۵ ستاره`}>{"★".repeat(item.rating)}<span>{"★".repeat(5 - item.rating)}</span></span>{item.comment && <span className="tenant-feedback-excerpt">{item.comment}</span>}</span>
          <span className="tenant-feedback-card-meta"><span className={`tenant-crm-status ${item.status === "NEEDS_ATTENTION" ? "is-feedback-attention" : item.status === "RESOLVED" ? "is-active" : ""}`}>{statusLabel(item.status)}</span><span>{sourceLabel(item.source)}</span><time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time></span>
          <span className="tenant-feedback-card-relation">{item.orderDisplayNumber ? `سفارش #${item.orderDisplayNumber}` : item.reservationDate ? `رزرو ${item.reservationDate}، ${item.reservationStartTime}` : "بدون پیوند"}</span>
        </Link></li>)}</ul>
        <footer className="tenant-crm-pagination"><span>{number.format((page - 1) * 20 + 1)} تا {number.format(Math.min(page * 20, result.total))} از {number.format(result.total)}</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>قبلی</button><span>صفحه {number.format(page)} از {number.format(pages)}</span><button type="button" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>بعدی</button></div></footer>
      </> : <div className="tenant-crm-empty"><h2>{query || status || rating || source || dateFrom || dateTo ? "بازخوردی با این مشخصات پیدا نشد" : "هنوز بازخوردی ثبت نشده است"}</h2><p>بازخورد ثبت‌شده مشتریان از پنل یا یادداشت‌های حضوری و تلفنی در این فهرست نمایش داده می‌شود.</p></div>}
  </section>;
}
