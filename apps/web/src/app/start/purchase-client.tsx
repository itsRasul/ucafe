"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { PublicCatalog, persianNumber, toman } from "../platform-catalog";
import { Button, ButtonLink } from "../ui/primitives";
import { PurchaseIdentity } from "./purchase-identity";
import { PurchaseError, purchaseApi, tenantAdminUrl } from "./purchase-api";

type Draft = { slug: string; name: string; hostname: string };
type Quote = { amountToman: string; planKey: string; planName: string; billingMonths: number; expectedSubscriptionVersion: number; expectedPlanUpdatedAt: string };
type Prepared = Draft & { quote: Quote };
type Invoice = { id: string; status: string; paymentUrl?: string; plan: { name: string }; amountToman: string };

export function PurchaseClient({ catalog, selectedPlan }: { catalog: PublicCatalog | null; selectedPlan?: string }) {
  const [token, setToken] = useState("");
  const [planKey, setPlanKey] = useState(catalog?.plans.find((plan) => plan.key === selectedPlan)?.key ?? catalog?.plans[0]?.key ?? "");
  const [name, setName] = useState(""); const [slug, setSlug] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cafes, setCafes] = useState<Draft[]>([]);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [resume, setResume] = useState<Invoice | null>(null);
  const [availability, setAvailability] = useState<{ available: boolean; hostname: string } | null>(null);
  const [checking, setChecking] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const idempotency = useRef(""); const submitting = useRef(false);
  const plan = catalog?.plans.find((item) => item.key === planKey);
  const step = !token ? 1 : prepared ? 3 : 2;

  async function authenticated(accessToken: string) {
    const drafts = await purchaseApi<Draft[]>("/public/platform/purchase/drafts", accessToken);
    setCafes(await purchaseApi<Draft[]>("/public/platform/purchase/cafes", accessToken));
    const existing = drafts[0];
    if (existing) {
      setDraft(existing); setName(existing.name); setSlug(existing.slug);
      const invoices = await purchaseApi<Invoice[]>(`/public/platform/purchase/${existing.slug}/invoices`, accessToken);
      setResume(invoices.find((invoice) => invoice.status === "PENDING" && invoice.paymentUrl) ?? null);
    }
    setToken(accessToken); setError("");
  }

  useEffect(() => {
    setAvailability(null);
    if (!token || draft || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 63) { setChecking(false); return; }
    let canceled = false; setChecking(true);
    const timer = setTimeout(() => { void purchaseApi<{ available: boolean; hostname: string }>(`/public/platform/purchase/availability?slug=${encodeURIComponent(slug)}`, token).then((result) => { if (!canceled) setAvailability(result); }).catch(() => { if (!canceled) setError("بررسی نشانی انجام نشد؛ می‌توانید برای بررسی نهایی ادامه دهید."); }).finally(() => { if (!canceled) setChecking(false); }); }, 400);
    return () => { canceled = true; clearTimeout(timer); };
  }, [slug, token, draft]);

  async function run(action: () => Promise<void>) {
    if (submitting.current) return; submitting.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (reason) {
      if (reason instanceof PurchaseError && reason.status === 401) { setToken(""); sessionStorage.removeItem("ucafe_owner_access"); }
      setError(reason instanceof Error ? reason.message : "ارتباط برقرار نشد؛ دوباره تلاش کنید.");
    } finally { submitting.current = false; setBusy(false); }
  }
  function prepare(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await purchaseApi<Prepared>("/public/platform/purchase/prepare", token, { name: name.trim(), slug, planKey });
      setDraft(result); setPrepared(result); idempotency.current = crypto.randomUUID();
    });
  }
  function pay() {
    if (!prepared) return;
    void run(async () => {
      const result = await purchaseApi<Invoice>(`/public/platform/purchase/${prepared.slug}/checkout`, token, { planKey: prepared.quote.planKey, idempotencyKey: idempotency.current, expectedSubscriptionVersion: prepared.quote.expectedSubscriptionVersion, expectedPlanUpdatedAt: prepared.quote.expectedPlanUpdatedAt });
      setResume(result);
      if (result.paymentUrl) window.location.assign(result.paymentUrl);
      else if (result.status === "PAID") window.location.assign(`/start/result?slug=${prepared.slug}&intentId=${result.id}`);
      else { idempotency.current = crypto.randomUUID(); throw new Error("درگاه آماده نشد. دوباره تلاش کنید؛ اگر تعرفه تغییر کرده، خلاصه را تازه کنید."); }
    });
  }
  return <main className="ucafe-ui uc-purchase-page"><header className="uc-purchase-header uc-container"><a className="uc-brand" href="/"><img src="/brand/ucafe-logo-current.webp" alt="" width={64} height={58} /><strong>یوکافه</strong></a><a href="/#pricing">بازگشت به تعرفه‌ها</a></header><div className="uc-purchase-layout uc-container"><aside><h1>کافه‌ات را<br />با یوکافه بساز.</h1><p>چند قدم روشن تا سایت و محیط مدیریت کافه؛ پیش از پرداخت همه‌چیز را بررسی می‌کنی.</p><ol className="uc-purchase-steps">{["تأیید شماره", "اطلاعات کافه", "بررسی و پرداخت"].map((label, i) => <li key={label} aria-current={step === i + 1 ? "step" : undefined}><span>{persianNumber(i + 1)}</span>{label}</li>)}</ol>{plan && <div className="uc-purchase-plan"><strong>{plan.name}</strong><p>{plan.description}</p><span>{toman(plan.priceToman)} تومان / {persianNumber(plan.billingMonths)} ماه</span></div>}<a href="/#request">برای انتخاب پلن به مشاوره نیاز دارم</a></aside>
    <section className="uc-purchase-card" aria-label="شروع اشتراک" aria-busy={busy}>{error && <p id="purchase-error" role="alert" className="uc-alert uc-alert--error">{error}</p>}{token && cafes.length > 0 && <div className="uc-alert"><h2>کافه‌های من</h2><ul>{cafes.map((cafe) => <li key={cafe.slug}><a href={tenantAdminUrl(cafe.hostname)}>ورود به مدیریت {cafe.name}</a></li>)}</ul></div>}
      {!catalog?.plans.length ? <><h2>تعرفه‌ها در دسترس نیستند.</h2><p>برای دریافت اطلاعات به صفحه تعرفه‌ها برگردید و دوباره تلاش کنید.</p><ButtonLink href="/#pricing">بررسی تعرفه‌ها</ButtonLink></> : !token ? <PurchaseIdentity onAuthenticated={authenticated} /> : !prepared ? <><h2>{draft ? "شروع کافه‌ات را ادامه بده." : "کافه‌ات را معرفی کن."}</h2><p>{draft ? "پیش‌نویس قبلی با همین شماره پیدا شد. اشتراک تا تأیید پرداخت فعال نمی‌شود." : "فقط نام و نشانی کافه لازم است. بقیه اطلاعات را بعداً در پنل تکمیل می‌کنی."}</p>{resume?.paymentUrl && <div className="uc-alert"><p>یک فاکتور پرداخت‌نشده برای {resume.plan.name} داری.</p><ButtonLink href={resume.paymentUrl}>ادامه پرداخت قبلی</ButtonLink></div>}
        <form onSubmit={prepare}><label htmlFor="purchase-plan">پلن انتخابی</label><select id="purchase-plan" value={planKey} onChange={(event) => setPlanKey(event.target.value)} disabled={busy || Boolean(resume?.paymentUrl)}>{catalog.plans.map((item) => <option value={item.key} key={item.key}>{item.name} · {toman(item.priceToman)} تومان</option>)}</select><label htmlFor="purchase-name">نام کافه</label><input id="purchase-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} minLength={1} autoComplete="organization" required disabled={busy || Boolean(draft)} aria-describedby={error ? "purchase-error" : undefined} /><label htmlFor="purchase-slug">نشانی اختصاصی کافه</label><input id="purchase-slug" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="ltr" placeholder="my-cafe" required disabled={busy || Boolean(draft)} aria-describedby="purchase-slug-help purchase-slug-status" /><p id="purchase-slug-help" className="uc-field-hint">حروف کوچک انگلیسی، عدد و خط تیره. نشانی در سرور بررسی و ثبت می‌شود.</p><p id="purchase-slug-status" className="uc-field-hint" aria-live="polite">{draft ? <bdi dir="ltr">{draft.hostname}</bdi> : checking ? "در حال بررسی نشانی…" : availability ? <><bdi dir="ltr">{availability.hostname}</bdi> · {availability.available ? "این نشانی فعلاً آزاد است." : "این نشانی قبلاً ثبت شده؛ نشانی دیگری انتخاب کن."}</> : "نشانی کامل پس از بررسی نمایش داده می‌شود."}</p><Button disabled={busy || availability?.available === false || Boolean(resume?.paymentUrl)}>{busy ? "در حال بررسی…" : "بررسی اطلاعات و مبلغ"}</Button></form></> : <><h2>همه‌چیز آماده بررسی است.</h2><p>کافه فعلاً پیش‌نویس است. فقط پس از تأیید پرداخت توسط سرور، اشتراک و سایت فعال می‌شوند.</p><dl className="uc-purchase-review"><div><dt>کافه</dt><dd>{prepared.name}</dd></div><div><dt>نشانی</dt><dd><bdi dir="ltr">{prepared.hostname}</bdi></dd></div><div><dt>پلن</dt><dd>{prepared.quote.planName}</dd></div><div><dt>مدت اشتراک</dt><dd>{persianNumber(prepared.quote.billingMonths)} ماه</dd></div><div><dt>مبلغ پرداخت</dt><dd><strong>{toman(prepared.quote.amountToman)} تومان</strong></dd></div></dl><p className="uc-field-hint">تمدید خودکار ندارد. خرید مستقیم دوره آزمایشی ایجاد نمی‌کند.</p><Button disabled={busy} onClick={pay}>{busy ? "در حال آماده‌سازی درگاه…" : "پرداخت و فعال‌سازی اشتراک"}</Button><Button variant="outline" disabled={busy} onClick={() => { setPrepared(null); setResume(null); }}>بازگشت و بررسی دوباره</Button></>}
    </section></div></main>;
}
