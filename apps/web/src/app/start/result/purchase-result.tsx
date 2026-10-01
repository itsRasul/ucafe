"use client";

import { useState } from "react";
import { Button, ButtonLink } from "../../ui/primitives";
import { toman } from "../../platform-catalog";
import { PurchaseIdentity } from "../purchase-identity";
import { purchaseApi, tenantAdminUrl } from "../purchase-api";

type Invoice = { id: string; status: string; amountToman: string; paymentUrl?: string; plan: { name: string }; cafe: { name: string; slug: string; hostname: string } };
const labels: Record<string, string> = { PAID: "کافه‌ات به یوکافه خوش آمد.", CANCELED: "پرداخت لغو شد.", FAILED: "پرداخت تأیید نشد.", EXPIRED: "زمان این فاکتور تمام شد.", PENDING: "پرداخت هنوز تأیید نشده است.", VERIFYING: "پرداخت در حال بررسی است." };

export function PurchaseResult({ slug, intentId }: { slug: string; intentId: string }) {
  const [token, setToken] = useState(""); const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function load(accessToken: string) {
    setToken(accessToken); setBusy(true); setError("");
    try { setInvoice(await purchaseApi<Invoice>(`/public/platform/purchase/${encodeURIComponent(slug)}/invoices/${encodeURIComponent(intentId)}`, accessToken)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "نتیجه دریافت نشد."); }
    finally { setBusy(false); }
  }
  const adminUrl = invoice && typeof window !== "undefined" ? tenantAdminUrl(invoice.cafe.hostname) : "";
  const success = invoice?.status === "PAID";
  return <main className="ucafe-ui uc-purchase-page"><header className="uc-purchase-header uc-container"><a className="uc-brand" href="/"><img src="/brand/ucafe-logo-current.webp" alt="" width={64} height={58} /><strong>یوکافه</strong></a><a href="/start">مسیر شروع کافه</a></header><div className="uc-container uc-purchase-layout"><aside><h1>{success ? "حالا نوبت کافه توست." : "نتیجه پرداخت اشتراک"}</h1><p>{success ? "منو و هویت کافه را آماده کن؛ از همین چند قدم شروع کن." : "نتیجه را از سرور بررسی می‌کنیم. بازگشت از درگاه به‌تنهایی نشانه پرداخت موفق نیست."}</p></aside><section className="uc-purchase-card" aria-busy={busy} aria-label="نتیجه پرداخت">
    {!slug || !intentId ? <><h2>نشانی فاکتور کامل نیست.</h2><ButtonLink href="/start">بازگشت به شروع</ButtonLink></> : !token ? <PurchaseIdentity onAuthenticated={load} /> : <>{busy && <p role="status">در حال دریافت وضعیت فاکتور…</p>}{error && <p role="alert" className="uc-alert uc-alert--error">{error}</p>}{invoice && <><h2>{labels[invoice.status] ?? "وضعیت فاکتور"}</h2><dl className="uc-purchase-review"><div><dt>کافه</dt><dd>{invoice.cafe.name}</dd></div><div><dt>پلن</dt><dd>{invoice.plan.name}</dd></div><div><dt>مبلغ</dt><dd>{toman(invoice.amountToman)} تومان</dd></div></dl>{success ? <><p>پرداخت توسط سرور تأیید و اشتراک فعال شد. برای ورود به پنل کافه، همین شماره را دوباره تأیید کن.</p><ol className="uc-onboarding-links"><li><a href={`${adminUrl}/site`}>هویت و اطلاعات کافه</a><p>لوگو، راه تماس، نشانی و ساعت کاری را تکمیل کن.</p></li><li><a href={`${adminUrl}/menu`}>اولین آیتم منو</a><p>یک دسته‌بندی بساز و نام، تصویر و قیمت آیتم را وارد کن.</p></li><li><a href={adminUrl.replace(/\/admin$/, "/")}>پیش‌نمایش سایت کافه</a><p>تجربه مهمان را روی موبایل هم بررسی کن.</p></li></ol><ButtonLink href={adminUrl}>ورود به مدیریت کافه</ButtonLink></> : <><p>تا تأیید پرداخت، اشتراک جدیدی فعال نمی‌شود. با بازگشت به شروع، پیش‌نویس قبلی را ادامه بده.</p>{invoice.paymentUrl && <ButtonLink href={invoice.paymentUrl}>ادامه پرداخت این فاکتور</ButtonLink>}<ButtonLink href="/start" variant="outline">ادامه از پیش‌نویس کافه</ButtonLink></>}</>}{(!invoice || !success) && <Button disabled={busy} variant="outline" onClick={() => void load(token)}>بررسی دوباره وضعیت</Button>}</>}
  </section></div></main>;
}
