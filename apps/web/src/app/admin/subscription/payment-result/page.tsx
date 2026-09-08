"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAdminSession } from "../../admin-session";

type Invoice = { id: string; status: string; amountToman: string; plan: { name: string }; providerReference: string | null };
const statusLabels: Record<string, string> = { PENDING: "در انتظار پرداخت", VERIFYING: "در حال بررسی", PAID: "پرداخت موفق", FAILED: "پرداخت ناموفق", EXPIRED: "فاکتور منقضی شد" };
const nf = new Intl.NumberFormat("fa-IR");

export default function PaymentResultPage() {
  const params = useSearchParams();
  const intentId = params.get("intentId");
  const { api } = useAdminSession();
  const [invoice, setInvoice] = useState<Invoice>();
  const [error, setError] = useState("");
  useEffect(() => { if (intentId) api<Invoice>(`/tenant/payments/invoices/${intentId}`).then(setInvoice).catch((reason: Error) => setError(reason.message)); }, [api, intentId]);
  const status = invoice?.status ?? params.get("status") ?? "FAILED";
  const success = status === "PAID";
  return <section className="admin-section-state payment-result-state">
    <span className={`result-mark ${success ? "success" : "failed"}`}>{success ? "✓" : "!"}</span>
    <h1>{statusLabels[status] ?? "نتیجه پرداخت"}</h1>
    <p>{success ? "پرداخت با موفقیت تأیید شد و اشتراک کافه تمدید شد." : "اشتراک تغییری نکرده است. می‌توانید دوباره از بخش اشتراک اقدام کنید."}</p>
    {invoice && <dl><div><dt>طرح</dt><dd>{invoice.plan.name}</dd></div><div><dt>مبلغ</dt><dd>{nf.format(Number(invoice.amountToman))} تومان</dd></div><div><dt>شماره پیگیری</dt><dd dir="ltr">{invoice.providerReference ?? "—"}</dd></div></dl>}
    {error && <p className="admin-message error" role="alert">{error}</p>}
    <Link className="admin-preview-link" href="/admin">بازگشت به پنل</Link>
  </section>;
}
