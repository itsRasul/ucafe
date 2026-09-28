"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatJalaliDate } from "../../jalali-date";
import { TenantPermission, useAdminSession } from "../admin-session";
import { TenantCrmRelationshipPanel } from "./relationship-data";

type Order = { id: string; displayNumber: string; status: string; totalAmountToman: string; deliveryMethod: string; createdAt: string; statusChangedAt: string | null };
type Reservation = { id: string; status: string; reservationDate: string; startTime: string; partySize: number; createdAt: string; statusChangedAt: string | null };
type ClientDetailRecord = {
  id: string; firstName: string; lastName: string; phone: string; status: "ACTIVE" | "BLOCKED"; phoneVerifiedAt: string | null; createdAt: string;
  firstSeenAt: string; lastInteractionAt: string;
  summary: {
    orders: { trackedCount: number; deliveredCount: number; canceledCount: number; knownSpendToman: string; averageDeliveredOrderValueToman: string | null; firstOrderAt: string | null; lastOrderAt: string | null };
    reservations: { totalCount: number; completedCount: number; canceledCount: number; rejectedCount: number; noShowCount: number; firstReservationAt: string | null; lastReservationAt: string | null };
  };
  recentOrders: Order[]; recentReservations: Reservation[];
};
type TimelineItem = { eventKey: string; type: string; occurredAt: string; sourceType: "CLIENT" | "ORDER" | "RESERVATION" | "NOTE" | "REMINDER"; sourceId: string; metadata: Record<string, string | number> };
type TimelinePage = { items: TimelineItem[]; nextCursor: string | null };

const numbers = new Intl.NumberFormat("fa-IR");
const money = (value: string | null) => value === null ? "—" : `${numbers.format(BigInt(value))} تومان`;
const statusNames: Record<string, string> = {
  UNDER_REVIEW: "در انتظار بررسی", PREPARING: "در حال آماده‌سازی", READY: "آماده تحویل", OUT_FOR_DELIVERY: "در مسیر ارسال",
  DELIVERED: "تحویل‌شده", CANCELED: "لغوشده", PENDING: "در انتظار تأیید", CONFIRMED: "تأییدشده", REJECTED: "ردشده",
  COMPLETED: "انجام‌شده", NO_SHOW: "عدم حضور",
};

function dateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
}

function timelineTitle(item: TimelineItem) {
  const number = item.sourceType === "ORDER" ? `#${item.sourceId.slice(0, 8).toUpperCase()}` : "";
  if (item.type === "CLIENT_CREATED") return "ثبت‌نام مشتری";
  if (item.type === "NOTE_CREATED") return "یادداشت داخلی ثبت شد";
  if (item.type === "REMINDER_CREATED") return "یادآوری ثبت شد";
  if (item.type === "REMINDER_COMPLETED") return "یادآوری انجام شد";
  if (item.type === "ORDER_CREATED") return `سفارش ${number} ثبت شد`;
  if (item.sourceType === "ORDER") {
    const status = String(item.metadata.status ?? "");
    return `سفارش ${number}، ${statusNames[status] ?? "وضعیت به‌روز شد"}`;
  }
  if (item.type === "RESERVATION_CREATED") return "رزرو ثبت شد";
  if (item.sourceType === "RESERVATION") {
    const status = String(item.metadata.status ?? "");
    return `رزرو ${statusNames[status] ?? "وضعیت به‌روز شد"}`;
  }
  return "فعالیت مشتری";
}

function timelineDetail(item: TimelineItem) {
  if (item.type === "ORDER_CREATED") return `${money(String(item.metadata.totalAmountToman ?? "0"))} · ${item.metadata.deliveryMethod === "COURIER" ? "ارسال با پیک" : "تحویل در کافه"}`;
  if (item.type === "RESERVATION_CREATED") return `${formatJalaliDate(String(item.metadata.reservationDate))}، ${item.metadata.startTime} · ${numbers.format(Number(item.metadata.partySize))} نفر`;
  return "";
}

export function ClientDetail() {
  const { clientId } = useParams<{ clientId: string }>();
  const { access, api } = useAdminSession();
  const [client, setClient] = useState<ClientDetailRecord>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [timeline, setTimeline] = useState<TimelinePage>();
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState("");
  const [timelineRefresh, setTimelineRefresh] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const permitted = access.permissions.includes("tenant_crm.read" as TenantPermission);
  const entitled = access.features?.tenant_crm === true;
  const canReadOrders = access.permissions.includes("orders.read");
  const canReadReservations = access.permissions.includes("reservations.read");

  useEffect(() => {
    if (!permitted || !entitled) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError("");
    api<ClientDetailRecord>(`/tenant/crm/clients/${encodeURIComponent(clientId)}`).then((value) => { if (active) setClient(value); })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, clientId, entitled, permitted, refresh]);

  useEffect(() => {
    if (!permitted || !entitled) { setTimelineLoading(false); return; }
    let active = true;
    setTimelineLoading(true); setTimelineError(""); setTimeline(undefined);
    api<TimelinePage>(`/tenant/crm/clients/${encodeURIComponent(clientId)}/timeline?pageSize=20`).then((value) => { if (active) setTimeline(value); })
      .catch((reason: Error) => { if (active) setTimelineError(reason.message); })
      .finally(() => { if (active) setTimelineLoading(false); });
    return () => { active = false; };
  }, [api, clientId, entitled, permitted, timelineRefresh]);

  async function loadMore() {
    if (!timeline?.nextCursor || loadingMore) return;
    setLoadingMore(true); setTimelineError("");
    try {
      const params = new URLSearchParams({ pageSize: "20", cursor: timeline.nextCursor });
      const next = await api<TimelinePage>(`/tenant/crm/clients/${encodeURIComponent(clientId)}/timeline?${params}`);
      setTimeline((current) => current ? { items: [...current.items, ...next.items], nextCursor: next.nextCursor } : next);
    } catch (reason) { setTimelineError((reason as Error).message); }
    finally { setLoadingMore(false); }
  }

  if (!permitted) return <section className="tenant-crm-state"><h1>دسترسی محدود</h1><p>نقش شما اجازه مشاهده اطلاعات مشتری را ندارد.</p></section>;
  if (!entitled) return <section className="tenant-crm-state"><h1>CRM مشتریان</h1><p>مدیریت مشتریان در اشتراک فعلی فعال نیست.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;

  return <section className="tenant-crm tenant-crm-customer-360">
    <Link href="/admin/crm" className="tenant-crm-back">بازگشت به فهرست مشتریان</Link>
    {loading ? <p className="tenant-crm-message" role="status">در حال دریافت اطلاعات مشتری…</p>
      : error ? <div className="tenant-crm-message" role="alert"><h1>اطلاعات مشتری در دسترس نیست</h1><p>{error}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>تلاش دوباره</button></div>
        : client ? <>
          <article className="tenant-crm-detail">
            <header className="tenant-crm-heading"><div><p className="eyebrow">نمای ۳۶۰ درجه مشتری</p><h1>{client.firstName} {client.lastName}</h1></div><span className={`tenant-crm-status ${client.status === "ACTIVE" ? "is-active" : "is-blocked"}`}>{client.status === "ACTIVE" ? "فعال" : "مسدود"}</span></header>
            <dl className="tenant-crm-identity"><div><dt>شماره موبایل</dt><dd dir="ltr">{client.phone}</dd></div><div><dt>تأیید شماره</dt><dd>{client.phoneVerifiedAt ? `تأییدشده در ${dateTime(client.phoneVerifiedAt, access.tenant.timezone)}` : "تأیید نشده"}</dd></div><div><dt>تاریخ ثبت</dt><dd>{dateTime(client.firstSeenAt, access.tenant.timezone)}</dd></div><div><dt>آخرین تعامل</dt><dd>{dateTime(client.lastInteractionAt, access.tenant.timezone)}</dd></div></dl>
          </article>

          <section className="tenant-crm-section" aria-labelledby="tenant-crm-summary-title">
            <h2 id="tenant-crm-summary-title">خلاصه ارتباط</h2>
            <dl className="tenant-crm-metrics">
              <div><dt>هزینه ثبت‌شده در UCafe</dt><dd>{money(client.summary.orders.knownSpendToman)}</dd></div>
              <div><dt>سفارش تحویل‌شده</dt><dd>{numbers.format(client.summary.orders.deliveredCount)}</dd></div>
              <div><dt>میانگین سفارش تحویل‌شده</dt><dd>{money(client.summary.orders.averageDeliveredOrderValueToman)}</dd></div>
              <div><dt>کل رزروها</dt><dd>{numbers.format(client.summary.reservations.totalCount)}</dd></div>
              <div><dt>عدم حضور</dt><dd>{numbers.format(client.summary.reservations.noShowCount)}</dd></div>
            </dl>
            <p className="tenant-crm-note">هزینه ثبت‌شده، مجموع مبلغ نهایی سفارش‌های تحویل‌شده در UCafe است؛ پرداخت نقدی تأییدشده یا کل خریدهای بیرون از UCafe را نشان نمی‌دهد.</p>
            <p className="tenant-crm-subsummary">از {numbers.format(client.summary.orders.trackedCount)} سفارش ثبت‌شده، {numbers.format(client.summary.orders.canceledCount)} لغو شده است. رزروها: {numbers.format(client.summary.reservations.completedCount)} انجام‌شده، {numbers.format(client.summary.reservations.canceledCount)} لغو‌شده و {numbers.format(client.summary.reservations.rejectedCount)} ردشده.</p>
            <p className="tenant-crm-subsummary">سفارش‌ها: اولین {client.summary.orders.firstOrderAt ? dateTime(client.summary.orders.firstOrderAt, access.tenant.timezone) : "ثبت نشده"} · آخرین {client.summary.orders.lastOrderAt ? dateTime(client.summary.orders.lastOrderAt, access.tenant.timezone) : "ثبت نشده"}. رزروها: اولین {client.summary.reservations.firstReservationAt ? dateTime(client.summary.reservations.firstReservationAt, access.tenant.timezone) : "ثبت نشده"} · آخرین {client.summary.reservations.lastReservationAt ? dateTime(client.summary.reservations.lastReservationAt, access.tenant.timezone) : "ثبت نشده"}.</p>
          </section>

          <TenantCrmRelationshipPanel clientId={client.id} api={api} timeZone={access.tenant.timezone} canManage={access.permissions.includes("tenant_crm.manage" as TenantPermission)} />

          <section className="tenant-crm-section" aria-labelledby="tenant-crm-orders-title">
            <div className="tenant-crm-section-heading"><h2 id="tenant-crm-orders-title">سفارش‌های اخیر</h2>{canReadOrders && <Link href="/admin/orders">رفتن به سفارش‌ها</Link>}</div>
            {client.recentOrders.length ? <ul className="tenant-crm-activity-list">{client.recentOrders.map((order) => <li key={order.id}><div><strong>#{order.displayNumber}</strong><span>{dateTime(order.createdAt, access.tenant.timezone)} · {order.deliveryMethod === "COURIER" ? "ارسال با پیک" : "تحویل در کافه"}</span></div><div><span className="tenant-crm-status-text">{statusNames[order.status] ?? order.status}</span><strong>{money(order.totalAmountToman)}</strong></div></li>)}</ul>
              : <p className="tenant-crm-inline-empty">هنوز سفارشی برای این مشتری ثبت نشده است.</p>}
          </section>

          <section className="tenant-crm-section" aria-labelledby="tenant-crm-reservations-title">
            <div className="tenant-crm-section-heading"><h2 id="tenant-crm-reservations-title">رزروهای اخیر</h2>{canReadReservations && <Link href="/admin/reservations">رفتن به رزروها</Link>}</div>
            {client.recentReservations.length ? <ul className="tenant-crm-activity-list">{client.recentReservations.map((reservation) => <li key={reservation.id}><div><strong>{formatJalaliDate(reservation.reservationDate)}، {reservation.startTime}</strong><span>{numbers.format(reservation.partySize)} نفر · ثبت {dateTime(reservation.createdAt, access.tenant.timezone)}</span></div><span className="tenant-crm-status-text">{statusNames[reservation.status] ?? reservation.status}</span></li>)}</ul>
              : <p className="tenant-crm-inline-empty">هنوز رزروی برای این مشتری ثبت نشده است.</p>}
          </section>

          <section className="tenant-crm-section" aria-labelledby="tenant-crm-timeline-title">
            <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-timeline-title">فعالیت‌های مشتری</h2><p>این نما از اطلاعات فعلی سفارش‌ها و رزروها ساخته می‌شود؛ تغییر وضعیت‌های قبلی که ذخیره نشده‌اند در دسترس نیستند.</p></div></div>
            {timelineLoading ? <p className="tenant-crm-inline-empty" role="status">در حال دریافت فعالیت‌ها…</p>
              : timelineError && !timeline ? <div className="tenant-crm-inline-error" role="alert"><span>{timelineError}</span><button type="button" onClick={() => setTimelineRefresh((value) => value + 1)}>تلاش دوباره</button></div>
                : timeline?.items.length ? <>
                  <ol className="tenant-crm-timeline">{timeline.items.map((item) => <li key={item.eventKey}><time dateTime={item.occurredAt}>{dateTime(item.occurredAt, access.tenant.timezone)}</time><div><strong>{timelineTitle(item)}</strong>{timelineDetail(item) && <span>{timelineDetail(item)}</span>}</div></li>)}</ol>
                  {timelineError && <p className="tenant-crm-inline-error" role="alert">{timelineError}</p>}
                  {timeline.nextCursor && <button className="tenant-crm-load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "در حال دریافت…" : "نمایش فعالیت‌های قدیمی‌تر"}</button>}
                </> : <p className="tenant-crm-inline-empty">هنوز فعالیتی ثبت نشده است.</p>}
          </section>
        </> : <p className="tenant-crm-message">مشتری پیدا نشد.</p>}
  </section>;
}
