"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAdminSession } from "../../../admin-session";

type Invoice = { id: string; status: string; operation: string; amountToman: string; pricing: { sourceCreditToman?: string; targetCostToman?: string }; plan: { name: string; billingMonths: number }; sourcePlan: { name: string } | null; effectiveTiming: string; periodStartedAt: string | null; periodEndsAt: string | null; providerReference: string | null; expiresAt: string; paymentUrl?: string };
const statusLabels: Record<string, string> = { PENDING: "در انتظار پرداخت", VERIFYING: "در حال بررسی", PAID: "پرداخت‌شده", FAILED: "ناموفق", EXPIRED: "منقضی", CANCELED: "لغوشده" };
const operationLabels: Record<string, string> = { PURCHASE: "خرید اشتراک", RENEWAL: "تمدید اشتراک", REACTIVATION: "فعال‌سازی دوباره", TRIAL_TO_PAID: "ارتقا از دوره آزمایشی", UPGRADE: "ارتقای پلن", LEGACY: "پرداخت اشتراک" };
const nf = new Intl.NumberFormat("fa-IR");
const money = (value: string) => `${nf.format(Number(value))} تومان`;
const date = (value: string | null) => value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "long", timeStyle: "short" }).format(new Date(value)) : "در زمان پرداخت موفق";

export default function InvoicePage() {
  const params = useParams<{ intentId: string }>();
  const { access, api } = useAdminSession();
  const [invoice, setInvoice] = useState<Invoice>();
  const [error, setError] = useState("");
  const canRead = access.permissions.includes("subscription.read");
  const canCheckout = access.permissions.includes("subscription.checkout");
  useEffect(() => { if (canRead) api<Invoice>(`/tenant/payments/invoices/${params.intentId}`).then(setInvoice).catch((reason: Error) => setError(reason.message)); }, [api, canRead, params.intentId]);
  if (!canRead) return <section className="admin-section-state"><h1>فاکتور</h1><p>نقش شما اجازه مشاهده این بخش را ندارد.</p></section>;
  if (!invoice && !error) return <section className="admin-section-state loading-state" aria-live="polite"><span className="admin-spinner" /><h1>در حال بارگذاری فاکتور…</h1></section>;
  return <section className="admin-readonly-section invoice-detail"><header><div><h1>{invoice ? operationLabels[invoice.operation] ?? "فاکتور اشتراک" : "فاکتور اشتراک"}</h1><p>مبلغ و تاریخ‌ها هنگام ساخت فاکتور در سرور ثبت شده‌اند.</p></div><Link className="admin-preview-link" href="/admin/invoices">همه فاکتورها</Link></header>{error && <p className="admin-message error" role="alert">{error}</p>}{invoice && <div className="billing-panel"><div className="invoice-title-row"><div><h2>{invoice.plan.name}</h2><p>{invoice.sourcePlan ? `تغییر از ${invoice.sourcePlan.name} به ${invoice.plan.name}` : `${nf.format(invoice.plan.billingMonths)} ماه دسترسی`}</p></div><span className={`invoice-status status-${invoice.status.toLowerCase()}`}>{statusLabels[invoice.status] ?? invoice.status}</span></div><dl>{invoice.operation === "UPGRADE" && <><div><dt>اعتبار پلن فعلی</dt><dd>{money(invoice.pricing.sourceCreditToman ?? "0")}</dd></div><div><dt>هزینه پلن جدید</dt><dd>{money(invoice.pricing.targetCostToman ?? "0")}</dd></div></>}<div><dt>مبلغ قابل پرداخت</dt><dd>{money(invoice.amountToman)}</dd></div><div><dt>شروع دوره / اثر تغییر</dt><dd>{date(invoice.periodStartedAt)}</dd></div><div><dt>پایان اعتبار</dt><dd>{date(invoice.periodEndsAt)}</dd></div><div><dt>اعتبار فاکتور</dt><dd>{date(invoice.expiresAt)}</dd></div><div><dt>شماره پیگیری</dt><dd dir="ltr">{invoice.providerReference ?? "—"}</dd></div></dl>{invoice.paymentUrl && canCheckout ? <a className="admin-preview-link pay-link" href={invoice.paymentUrl}>پرداخت از درگاه</a> : <p className="admin-message warning">{invoice.status === "PAID" ? "این فاکتور پرداخت شده است." : "این فاکتور قابل پرداخت نیست؛ از صفحه اشتراک دوباره اقدام کنید."}</p>}</div>}</section>;
}
