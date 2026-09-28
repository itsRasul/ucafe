"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TenantPermission, useAdminSession } from "../admin-session";

type ClientRow = { id: string; firstName: string; lastName: string; phone: string; status: "ACTIVE" | "BLOCKED"; createdAt: string };
type ClientPage = { items: ClientRow[]; total: number; page: number; pageSize: number };
const number = new Intl.NumberFormat("fa-IR");
const date = (value: string) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(value));
const statusName = (status: ClientRow["status"]) => status === "ACTIVE" ? "فعال" : "مسدود";

export function ClientDirectory() {
  const { access, api } = useAdminSession();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("createdAt:desc");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<ClientPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const permitted = access.permissions.includes("tenant_crm.read" as TenantPermission);
  const entitled = access.features?.tenant_crm === true;

  useEffect(() => {
    if (!permitted || !entitled) return;
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      const [sortBy, sortOrder] = sort.split(":");
      const params = new URLSearchParams({ q: query, page: String(page), pageSize: "25", sortBy: sortBy ?? "createdAt", sortOrder: sortOrder ?? "desc" });
      if (status) params.set("status", status);
      api<ClientPage>(`/tenant/crm/clients?${params}`).then((value) => { if (active) setResult(value); })
        .catch((reason: Error) => { if (active) setError(reason.message); })
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [api, entitled, page, permitted, query, refresh, sort, status]);

  if (!permitted) return <section className="tenant-crm-state"><p className="eyebrow">دسترسی محدود</p><h1>CRM مشتریان</h1><p>نقش شما اجازه مشاهده فهرست مشتریان را ندارد.</p></section>;
  if (!entitled) return <section className="tenant-crm-state"><p className="eyebrow">مدیریت کافه</p><h1>CRM مشتریان</h1><p>مدیریت مشتریان در اشتراک فعلی فعال نیست.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / 25));

  return <section className="tenant-crm" dir="rtl" aria-busy={loading}>
    <header className="tenant-crm-heading"><div><p className="eyebrow">مدیریت کافه</p><h1>CRM مشتریان</h1><p>فهرست مشتریان این کافه</p></div><span className="tenant-crm-count">{result ? `${number.format(result.total)} مشتری` : "فهرست مشتریان"}</span></header>
    <div className="tenant-crm-tools">
      <label>جست‌وجوی نام یا شماره<input type="search" value={query} maxLength={100} placeholder="نام یا شماره موبایل" onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
      <label>وضعیت<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">همه مشتریان</option><option value="ACTIVE">فعال</option><option value="BLOCKED">مسدود</option></select></label>
      <label>مرتب‌سازی<select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="createdAt:desc">جدیدترین</option><option value="createdAt:asc">قدیمی‌ترین</option><option value="name:asc">نام، الفبایی</option><option value="name:desc">نام، معکوس</option></select></label>
    </div>
    {error ? <div className="tenant-crm-message" role="alert"><p>{error}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>تلاش دوباره</button></div>
      : loading && !result ? <p className="tenant-crm-message" role="status">در حال دریافت مشتریان…</p>
        : result?.items.length ? <>
          {loading && <p className="tenant-crm-loading" role="status">در حال به‌روزرسانی فهرست…</p>}
          <ul className="tenant-crm-list">{result.items.map((client) => <li key={client.id}>
            <Link href={`/admin/crm/clients/${client.id}`} className="tenant-crm-client">
              <span className="tenant-crm-client-main"><strong>{client.firstName} {client.lastName}</strong><span dir="ltr">{client.phone}</span></span>
              <span className={`tenant-crm-status ${client.status === "ACTIVE" ? "is-active" : "is-blocked"}`}>{statusName(client.status)}</span>
              <time dateTime={client.createdAt}>عضویت از {date(client.createdAt)}</time>
              <span className="tenant-crm-open" aria-hidden="true">‹</span>
            </Link>
          </li>)}</ul>
          <footer className="tenant-crm-pagination"><span>{number.format(result.total ? (page - 1) * 25 + 1 : 0)} تا {number.format(Math.min(page * 25, result.total))} از {number.format(result.total)}</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>قبلی</button><span>صفحه {number.format(page)} از {number.format(pages)}</span><button type="button" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>بعدی</button></div></footer>
        </> : <div className="tenant-crm-empty"><span aria-hidden="true">◎</span><h2>{query || status ? "مشتری‌ای با این مشخصات پیدا نشد" : "هنوز مشتری‌ای ثبت نشده است"}</h2><p>{query || status ? "عبارت جست‌وجو یا فیلتر را تغییر دهید." : "با ثبت‌نام مشتریان یا ایجاد رزرو، فهرست اینجا نمایش داده می‌شود."}</p></div>}
  </section>;
}
