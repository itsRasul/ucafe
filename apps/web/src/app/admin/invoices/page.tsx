"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";

type Invoice = { id: string; status: string; amountToman: string; plan: { name: string }; providerReference: string | null; createdAt: string; paidAt: string | null };
const statusLabels: Record<string, string> = { PENDING: "در انتظار پرداخت", VERIFYING: "در حال بررسی", PAID: "پرداخت‌شده", FAILED: "ناموفق", EXPIRED: "منقضی" };
const nf = new Intl.NumberFormat("fa-IR");
function date(value: string | null) { return value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }

export default function InvoicesPage() {
  const { access, api } = useAdminSession();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canRead = access.permissions.includes("subscription.read");
  useEffect(() => { if (canRead) api<Invoice[]>("/tenant/payments/invoices").then(setInvoices).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false)); }, [api, canRead]);
  if (!canRead) return <section className="admin-section-state"><h1>فاکتورها</h1><p>نقش شما اجازه مشاهده این بخش را ندارد.</p></section>;
  return <section className="admin-readonly-section">
    <header><div><h1>فاکتورها</h1><p>سوابق فاکتورهای تمدید اشتراک کافه.</p></div><Link className="admin-preview-link" href="/admin/subscription">اشتراک</Link></header>
    {loading ? <div className="admin-inline-loading"><span className="admin-spinner" />در حال بارگذاری…</div> : error ? <p className="admin-message error" role="alert">{error}</p> : invoices.length === 0 ? <div className="admin-empty"><strong>هنوز فاکتوری ثبت نشده است.</strong><p>از بخش اشتراک می‌توانید فاکتور تمدید بسازید.</p></div> : <div className="invoice-list">{invoices.map((invoice) => <Link href={`/admin/subscription/invoice/${invoice.id}`} key={invoice.id}>
      <span><strong>{invoice.plan.name}</strong><small>{date(invoice.paidAt ?? invoice.createdAt)}</small></span>
      <span><b>{nf.format(Number(invoice.amountToman))} تومان</b><i className={`invoice-status status-${invoice.status.toLowerCase()}`}>{statusLabels[invoice.status] ?? invoice.status}</i></span>
      <span><small>شماره پیگیری</small><code>{invoice.providerReference ?? "—"}</code></span>
    </Link>)}</div>}
  </section>;
}
