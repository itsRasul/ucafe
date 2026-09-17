"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ClientIdentity, ClientSession, clientRequest, useClientSession } from "../client-session";
import { formatJalaliDate } from "../jalali-date";
import { OtpCodeFields } from "../otp-code-fields";
import { formatToman } from "../tenant-public";

type OrderStatus = "UNDER_REVIEW" | "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED";
type ReservationStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELED" | "COMPLETED" | "NO_SHOW";
type DeliveryMethod = "PICKUP" | "COURIER";
type OrderSummary = { id: string; status: OrderStatus; deliveryMethod: DeliveryMethod; paymentMethod: "OFFLINE"; totalAmountToman: string; createdAt: string; updatedAt: string };
type ReservationSummary = { id: string; branchId: string; contactName: string; reservationDate: string; startTime: string; endTime: string; partySize: number; status: ReservationStatus; customerNote: string | null; createdAt: string };
type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };
type AddressSnapshot = { label: string | null; province: string | null; city: string | null; addressLine: string; buildingNumber: string | null; unit: string | null; postalCode: string | null };
type OrderDetail = OrderSummary & { deliveryAddressSnapshot: AddressSnapshot | null; customerNote: string | null; statusChangedAt: string | null; items: Array<{ id: string; itemName: string; variantName: string | null; unitPriceToman: string; quantity: number; lineTotalToman: string }> };
type ReservationDetail = ReservationSummary & { branch: { id: string; name: string; address: string | null } | null };
type Overview = {
  counts: { totalOrders: number; activeOrders: number; totalReservations: number; upcomingReservations: number };
  latestOrder: Pick<OrderSummary, "id" | "status" | "deliveryMethod" | "totalAmountToman" | "createdAt"> | null;
  nextReservation: Pick<ReservationSummary, "id" | "reservationDate" | "startTime" | "partySize" | "status"> & { branch: { name: string; address: string | null } | null } | null;
};

const orderLabels: Record<OrderStatus, string> = { UNDER_REVIEW: "در حال بررسی", PREPARING: "در حال آماده‌سازی", READY: "آماده تحویل", OUT_FOR_DELIVERY: "در مسیر ارسال", DELIVERED: "تحویل داده شده" };
const reservationLabels: Record<ReservationStatus, string> = { PENDING: "در انتظار تأیید", CONFIRMED: "تأیید شده", REJECTED: "رد شده", CANCELED: "لغو شده", COMPLETED: "انجام شده", NO_SHOW: "عدم مراجعه" };
const deliveryLabels: Record<DeliveryMethod, string> = { PICKUP: "تحویل در کافه", COURIER: "ارسال با پیک" };
const fa = new Intl.NumberFormat("fa-IR");
const faMoment = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "long", timeStyle: "short" });

function phone(value: string) { return value.replace(/^\+98/, "0"); }
function moment(value: string) { return faMoment.format(new Date(value)); }
function statusClass(value: string) { return `panel-status panel-status-${value.toLowerCase()}`; }

type ReadySession = ClientSession & { client: ClientIdentity };
const PanelContext = createContext<ReadySession | null>(null);
function usePanelSession() {
  const value = useContext(PanelContext);
  if (!value) throw new Error("Panel session is unavailable");
  return value;
}

const navigation = [
  { href: "/panel", label: "نمای کلی", short: "خانه", icon: "home" },
  { href: "/panel/orders", label: "سفارش‌ها", short: "سفارش", icon: "bag" },
  { href: "/panel/reservations", label: "رزروها", short: "رزرو", icon: "calendar" },
  { href: "/panel/profile", label: "حساب کاربری", short: "حساب", icon: "user" },
] as const;

function Icon({ name }: { name: string }) {
  if (name === "home") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 10 8-7 8 7v10h-6v-6h-4v6H4Z" /></svg>;
  if (name === "bag") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 8h14l-1 13H6L5 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></svg>;
  if (name === "calendar") return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4m8-4v4M3 10h18" /></svg>;
  if (name === "user") return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 5h6v14H4V5h6m2-2v12m-4-4 4 4 4-4" /></svg>;
}

function isActive(pathname: string, href: string) { return href === "/panel" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`); }

export function PanelShell({ cafeName, logoUrl, children }: { cafeName: string; logoUrl?: string; children: React.ReactNode }) {
  const session = useClientSession();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (session.state === "ready" && !session.client) {
      const next = pathname.startsWith("/panel") ? pathname : "/panel";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [pathname, router, session.client, session.state]);

  if (session.state === "loading" || !session.client) return <main className="panel-auth-loading" aria-live="polite"><span className="panel-spinner" /><p>در حال آماده‌سازی پنل شما…</p></main>;

  async function signOut() { await session.signOut(); router.replace("/"); }
  const ready = session as ReadySession;
  return <PanelContext.Provider value={ready}>
    <main className="client-panel-app">
      <div className="panel-frame">
        <aside className="panel-sidebar">
          <div>
            <Link className="panel-brand" href="/panel">
              {logoUrl ? <img src={logoUrl} alt={`نشان ${cafeName}`} /> : <span aria-hidden="true">{cafeName.trim().charAt(0)}</span>}
              <div><strong>{cafeName}</strong><small>پنل مشتری</small></div>
            </Link>
            <nav aria-label="ناوبری پنل مشتری">{navigation.map((item) => <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "active" : ""} aria-current={isActive(pathname, item.href) ? "page" : undefined}><Icon name={item.icon} /><span>{item.label}</span></Link>)}</nav>
          </div>
          <div className="panel-account-summary">
            <span className="panel-avatar" aria-hidden="true">{session.client.firstName.charAt(0)}</span>
            <div><strong>{session.client.firstName} {session.client.lastName}</strong><small dir="ltr">{phone(session.client.phone)}</small></div>
            <Link href="/" className="panel-site-link">مشاهده سایت کافه</Link>
            <button type="button" onClick={() => void signOut()}><Icon name="logout" />خروج از حساب</button>
          </div>
        </aside>
        <div className="panel-main">
          <header className="panel-mobile-header"><Link className="panel-brand" href="/panel">{logoUrl ? <img src={logoUrl} alt={`نشان ${cafeName}`} /> : <span aria-hidden="true">{cafeName.trim().charAt(0)}</span>}<strong>{cafeName}</strong></Link><Link href="/" aria-label="مشاهده سایت کافه">سایت کافه</Link></header>
          <div className="panel-content">{children}</div>
          <nav className="panel-bottom-nav" aria-label="ناوبری موبایل پنل">{navigation.map((item) => <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "active" : ""} aria-current={isActive(pathname, item.href) ? "page" : undefined}><Icon name={item.icon} /><span>{item.short}</span></Link>)}</nav>
        </div>
      </div>
    </main>
  </PanelContext.Provider>;
}

function usePanelResource<T>(path: string) {
  const { api } = usePanelSession();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError("");
    api<T>(path).then((result) => { if (current) setData(result); }).catch((reason: Error) => { if (current) setError(reason.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, path, version]);
  return { data, loading, error, retry: () => setVersion((value) => value + 1) };
}

function LoadingBlock({ rows = 3 }: { rows?: number }) { return <div className="panel-skeleton" aria-label="در حال بارگذاری">{Array.from({ length: rows }, (_, index) => <span key={index} />)}</div>; }
function ErrorBlock({ message, retry }: { message: string; retry: () => void }) { return <div className="panel-state panel-state-error" role="alert"><strong>بارگذاری انجام نشد</strong><p>{message}</p><button type="button" onClick={retry}>تلاش دوباره</button></div>; }
function Status({ kind, label }: { kind: string; label: string }) { return <span className={statusClass(kind)}>{label}</span>; }

export function PanelOverview() {
  const session = usePanelSession();
  const result = usePanelResource<Overview>("/public/client-panel/overview");
  const root = useRef<HTMLElement>(null);
  useGSAP(() => {
    if (!result.data || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo("[data-panel-enter]", { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: .58, stagger: .065, ease: "power3.out", clearProps: "opacity,visibility,transform" });
  }, { scope: root, dependencies: [result.data] });

  return <section className="panel-overview" ref={root} aria-labelledby="panel-overview-title">
    <header className="panel-page-heading panel-overview-heading" data-panel-enter><div><h1 id="panel-overview-title">سلام {session.client.firstName}، اینجا حساب شماست.</h1><p>آخرین وضعیت سفارش‌ها و رزروها را یک‌جا ببینید و سریع به کار بعدی برسید.</p></div><div className="panel-heading-actions"><Link className="panel-primary-action" href="/menu">سفارش تازه</Link><Link className="panel-secondary-action" href="/reserve">رزرو میز</Link></div></header>
    {result.loading && !result.data ? <LoadingBlock rows={5} /> : result.error ? <ErrorBlock message={result.error} retry={result.retry} /> : result.data && <>
      <dl className="panel-measures" data-panel-enter>
        <div><dt>سفارش فعال</dt><dd>{fa.format(result.data.counts.activeOrders)}</dd><small>از {fa.format(result.data.counts.totalOrders)} سفارش</small></div>
        <div><dt>رزرو پیش‌رو</dt><dd>{fa.format(result.data.counts.upcomingReservations)}</dd><small>از {fa.format(result.data.counts.totalReservations)} رزرو</small></div>
        <div><dt>همه سفارش‌ها</dt><dd>{fa.format(result.data.counts.totalOrders)}</dd><Link href="/panel/orders">مشاهده تاریخچه</Link></div>
        <div><dt>همه رزروها</dt><dd>{fa.format(result.data.counts.totalReservations)}</dd><Link href="/panel/reservations">مشاهده تاریخچه</Link></div>
      </dl>
      <div className="panel-activity-grid">
        <section className="panel-activity panel-latest-order" data-panel-enter><header><div><h2>آخرین سفارش</h2><p>وضعیت واقعی آماده‌سازی و تحویل</p></div><Link href="/panel/orders">همه سفارش‌ها</Link></header>{result.data.latestOrder ? <><div className="panel-activity-status"><Status kind={result.data.latestOrder.status} label={orderLabels[result.data.latestOrder.status]} /><time>{moment(result.data.latestOrder.createdAt)}</time></div><div className="panel-order-amount"><span>{deliveryLabels[result.data.latestOrder.deliveryMethod]}</span><strong>{formatToman(result.data.latestOrder.totalAmountToman)}</strong></div><Link className="panel-row-link" href={`/panel/orders/${result.data.latestOrder.id}`}>جزئیات سفارش <span aria-hidden="true">←</span></Link></> : <div className="panel-empty"><strong>هنوز سفارشی ندارید</strong><p>منوی کافه را ببینید و اولین سفارش را ثبت کنید.</p><Link href="/menu">مشاهده منو</Link></div>}</section>
        <section className="panel-activity panel-next-reservation" data-panel-enter><header><div><h2>رزرو بعدی</h2><p>زمان و نشانی مراجعه</p></div><Link href="/panel/reservations">همه رزروها</Link></header>{result.data.nextReservation ? <><div className="panel-date-block"><strong>{formatJalaliDate(result.data.nextReservation.reservationDate)}</strong><span>ساعت {result.data.nextReservation.startTime} · {fa.format(result.data.nextReservation.partySize)} نفر</span></div><Status kind={result.data.nextReservation.status} label={reservationLabels[result.data.nextReservation.status]} />{result.data.nextReservation.branch && <address>{result.data.nextReservation.branch.name}{result.data.nextReservation.branch.address ? `، ${result.data.nextReservation.branch.address}` : ""}</address>}<Link className="panel-row-link" href={`/panel/reservations/${result.data.nextReservation.id}`}>جزئیات رزرو <span aria-hidden="true">←</span></Link></> : <div className="panel-empty"><strong>رزرو پیش‌رویی ندارید</strong><p>زمان مناسب را انتخاب کنید؛ باقی کار کوتاه است.</p><Link href="/reserve">رزرو میز</Link></div>}</section>
      </div>
    </>}
  </section>;
}

export function PanelProfile() {
  const session = usePanelSession();
  const [firstName, setFirstName] = useState(session.client.firstName);
  const [lastName, setLastName] = useState(session.client.lastName);
  const [newPhone, setNewPhone] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [digits, setDigits] = useState(() => Array.from({ length: 6 }, () => ""));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function saveNames(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await session.api("/public/client-panel/profile", { method: "PATCH", body: JSON.stringify({ firstName, lastName }) }); await session.reloadClient(); setNotice("نام و نام خانوادگی شما ذخیره شد."); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function requestPhone(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { const result = await session.api<{ challengeId: string }>("/public/client-panel/profile/phone/otp/request", { method: "POST", body: JSON.stringify({ phone: newPhone }) }); setChallengeId(result.challengeId); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function verifyPhone(code = digits.join("")) {
    if (code.length !== 6 || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await clientRequest("/public/client-panel/profile/phone/otp/verify", session.token, { method: "POST", body: JSON.stringify({ challengeId, otp: code }) });
      await session.reloadClient(); setChallengeId(""); setNewPhone(""); setDigits(Array.from({ length: 6 }, () => "")); setNotice("شماره موبایل تأیید و جایگزین شد. نشست فعلی شما حفظ شده است.");
    } catch (reason) { setError((reason as { status?: number } ).status === 409 ? "این شماره قبلاً برای مشتری دیگری در همین کافه ثبت شده است." : (reason as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="panel-narrow" aria-labelledby="profile-title"><header className="panel-page-heading"><div><h1 id="profile-title">حساب کاربری</h1><p>اطلاعاتی که کافه برای شناسایی سفارش و رزرو شما می‌بیند.</p></div></header>{error && <p className="panel-message error" role="alert">{error}</p>}{notice && <p className="panel-message success" role="status">{notice}</p>}
    <form className="panel-form" onSubmit={saveNames}><div className="panel-section-heading"><h2>نام شما</h2><p>نام را همان‌طور وارد کنید که مایلید در کافه خطاب شوید.</p></div><div className="panel-form-grid"><label htmlFor="profile-first-name">نام<input id="profile-first-name" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={80} required /></label><label htmlFor="profile-last-name">نام خانوادگی<input id="profile-last-name" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={80} required /></label></div><button className="panel-primary-action" disabled={busy}>ذخیره نام</button></form>
    <section className="panel-form panel-phone-change" aria-labelledby="phone-change-title"><div className="panel-section-heading"><h2 id="phone-change-title">شماره موبایل</h2><p>شماره فعلی: <bdi dir="ltr">{phone(session.client.phone)}</bdi></p></div>{!challengeId ? <form onSubmit={requestPhone}><label htmlFor="profile-phone">شماره جدید<input id="profile-phone" dir="ltr" inputMode="tel" autoComplete="tel" placeholder="09123456789" value={newPhone} onChange={(event) => setNewPhone(event.target.value)} required /></label><button className="panel-secondary-action" disabled={busy}>{busy ? "در حال ارسال…" : "ارسال کد تأیید"}</button></form> : <form onSubmit={(event) => { event.preventDefault(); void verifyPhone(); }}><p>کد شش‌رقمی ارسال‌شده به <bdi dir="ltr">{newPhone}</bdi> را وارد کنید.</p><fieldset><legend>کد تأیید</legend><OtpCodeFields className="panel-otp-inputs" value={digits} onChange={setDigits} onComplete={(code) => void verifyPhone(code)} disabled={busy} /></fieldset><div className="panel-form-actions"><button className="panel-primary-action" disabled={busy || digits.join("").length !== 6}>{busy ? "در حال بررسی…" : "تأیید شماره"}</button><button className="panel-text-button" type="button" onClick={() => { setChallengeId(""); setDigits(Array.from({ length: 6 }, () => "")); setError(""); }} disabled={busy}>اصلاح شماره</button></div></form>}<p className="panel-privacy-note">حساب شما رمز عبور ندارد. مالکیت شماره جدید فقط با کد یک‌بارمصرف تأیید می‌شود.</p></section>
  </section>;
}

function Pagination({ page, total, pageSize, setPage }: { page: number; total: number; pageSize: number; setPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return <nav className="panel-pagination" aria-label="صفحه‌بندی"><button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1}>صفحه قبل</button><span>صفحه {fa.format(page)} از {fa.format(pages)}</span><button type="button" onClick={() => setPage(page + 1)} disabled={page >= pages}>صفحه بعد</button></nav>;
}

export function PanelOrders() {
  const [page, setPage] = useState(1);
  const result = usePanelResource<PageResult<OrderSummary>>(`/public/orders?page=${page}&pageSize=10`);
  return <section aria-labelledby="orders-title"><header className="panel-page-heading"><div><h1 id="orders-title">سفارش‌ها</h1><p>تاریخچه سفارش‌ها و وضعیت فعلی آماده‌سازی یا تحویل.</p></div><Link className="panel-primary-action" href="/menu">سفارش تازه</Link></header>{result.loading && !result.data ? <LoadingBlock rows={6} /> : result.error ? <ErrorBlock message={result.error} retry={result.retry} /> : result.data && (result.data.items.length ? <><ol className="panel-history-list">{result.data.items.map((order) => <li key={order.id}><Link href={`/panel/orders/${order.id}`}><div><Status kind={order.status} label={orderLabels[order.status]} /><h2>{deliveryLabels[order.deliveryMethod]}</h2><time>{moment(order.createdAt)}</time></div><div><strong>{formatToman(order.totalAmountToman)}</strong><span aria-hidden="true">←</span></div></Link></li>)}</ol><Pagination page={result.data.page} total={result.data.total} pageSize={result.data.pageSize} setPage={setPage} /></> : <div className="panel-state"><strong>هنوز سفارشی ثبت نشده است</strong><p>پس از ثبت سفارش، مسیر آماده‌سازی آن اینجا نمایش داده می‌شود.</p><Link href="/menu">مشاهده منو</Link></div>)}</section>;
}

export function PanelReservations() {
  const [page, setPage] = useState(1);
  const result = usePanelResource<PageResult<ReservationSummary>>(`/public/reservations/mine?page=${page}&pageSize=10`);
  return <section aria-labelledby="reservations-title"><header className="panel-page-heading"><div><h1 id="reservations-title">رزروها</h1><p>رزروهای پیش‌رو و سابقه مراجعه‌های شما به کافه.</p></div><Link className="panel-primary-action" href="/reserve">رزرو میز</Link></header>{result.loading && !result.data ? <LoadingBlock rows={6} /> : result.error ? <ErrorBlock message={result.error} retry={result.retry} /> : result.data && (result.data.items.length ? <><ol className="panel-history-list">{result.data.items.map((reservation) => <li key={reservation.id}><Link href={`/panel/reservations/${reservation.id}`}><div><Status kind={reservation.status} label={reservationLabels[reservation.status]} /><h2>{formatJalaliDate(reservation.reservationDate)}، ساعت {reservation.startTime}</h2><span>{fa.format(reservation.partySize)} نفر · {reservation.contactName}</span></div><span aria-hidden="true">←</span></Link></li>)}</ol><Pagination page={result.data.page} total={result.data.total} pageSize={result.data.pageSize} setPage={setPage} /></> : <div className="panel-state"><strong>رزروی در حساب شما نیست</strong><p>زمان و تعداد نفرات را انتخاب کنید تا رزرو اینجا ثبت شود.</p><Link href="/reserve">رزرو میز</Link></div>)}</section>;
}

export function PanelOrderDetail({ id }: { id: string }) {
  const result = usePanelResource<OrderDetail>(`/public/orders/${id}`);
  if (result.loading && !result.data) return <section><LoadingBlock rows={7} /></section>;
  if (result.error) return <ErrorBlock message={result.error} retry={result.retry} />;
  if (!result.data) return null;
  const order = result.data;
  const stages: OrderStatus[] = order.deliveryMethod === "COURIER" ? ["UNDER_REVIEW", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"] : ["UNDER_REVIEW", "PREPARING", "READY", "DELIVERED"];
  const current = stages.indexOf(order.status);
  const address = order.deliveryAddressSnapshot;
  return <article className="panel-detail" aria-labelledby="order-detail-title"><Link className="panel-back-link" href="/panel/orders">بازگشت به سفارش‌ها</Link><header className="panel-detail-header"><div><h1 id="order-detail-title">جزئیات سفارش</h1><bdi dir="ltr">{order.id}</bdi></div><Status kind={order.status} label={orderLabels[order.status]} /></header><section className="panel-tracker" aria-labelledby="tracker-title"><h2 id="tracker-title">مسیر سفارش</h2><ol>{stages.map((stage, index) => <li key={stage} className={index < current ? "complete" : index === current ? "current" : ""}><span aria-hidden="true" /><div><strong>{orderLabels[stage]}</strong>{index === current && <small>وضعیت فعلی</small>}</div></li>)}</ol></section><dl className="panel-detail-list"><div><dt>مبلغ کل</dt><dd>{formatToman(order.totalAmountToman)}</dd></div><div><dt>روش پرداخت</dt><dd>پرداخت حضوری</dd></div><div><dt>روش تحویل</dt><dd>{deliveryLabels[order.deliveryMethod]}</dd></div><div><dt>زمان ثبت</dt><dd>{moment(order.createdAt)}</dd></div><div><dt>آخرین به‌روزرسانی</dt><dd>{moment(order.updatedAt)}</dd></div></dl><section className="panel-detail-section"><h2>اقلام سفارش</h2><ul className="panel-order-items">{order.items.map((item) => <li key={item.id}><div><strong>{item.itemName}</strong>{item.variantName && <span>{item.variantName}</span>}</div><span>{fa.format(item.quantity)} × {formatToman(item.unitPriceToman)}</span><b>{formatToman(item.lineTotalToman)}</b></li>)}</ul></section>{address && <section className="panel-detail-section"><h2>{address.label ?? "نشانی ارسال"}</h2><address>{[address.province, address.city, address.addressLine, address.buildingNumber && `پلاک ${address.buildingNumber}`, address.unit && `واحد ${address.unit}`].filter(Boolean).join("، ")}</address>{address.postalCode && <p>کد پستی: <bdi dir="ltr">{address.postalCode}</bdi></p>}</section>}{order.customerNote && <section className="panel-detail-section"><h2>یادداشت شما</h2><p>{order.customerNote}</p></section>}</article>;
}

export function PanelReservationDetail({ id }: { id: string }) {
  const result = usePanelResource<ReservationDetail>(`/public/reservations/mine/${id}`);
  if (result.loading && !result.data) return <section><LoadingBlock rows={6} /></section>;
  if (result.error) return <ErrorBlock message={result.error} retry={result.retry} />;
  if (!result.data) return null;
  const reservation = result.data;
  return <article className="panel-detail panel-reservation-detail" aria-labelledby="reservation-detail-title"><Link className="panel-back-link" href="/panel/reservations">بازگشت به رزروها</Link><header className="panel-detail-header"><div><h1 id="reservation-detail-title">جزئیات رزرو</h1><bdi dir="ltr">{reservation.id}</bdi></div><Status kind={reservation.status} label={reservationLabels[reservation.status]} /></header><div className="panel-reservation-date"><strong>{formatJalaliDate(reservation.reservationDate)}</strong><span>از ساعت {reservation.startTime} تا {reservation.endTime}</span></div><dl className="panel-detail-list"><div><dt>تعداد نفرات</dt><dd>{fa.format(reservation.partySize)} نفر</dd></div><div><dt>نام رزرو</dt><dd>{reservation.contactName}</dd></div><div><dt>زمان ثبت</dt><dd>{moment(reservation.createdAt)}</dd></div>{reservation.branch && <><div><dt>شعبه</dt><dd>{reservation.branch.name}</dd></div>{reservation.branch.address && <div><dt>نشانی</dt><dd><address>{reservation.branch.address}</address></dd></div>}</>}</dl>{reservation.customerNote && <section className="panel-detail-section"><h2>یادداشت شما</h2><p>{reservation.customerNote}</p></section>}</article>;
}
