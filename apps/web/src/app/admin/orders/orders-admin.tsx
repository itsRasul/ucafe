"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { JalaliDateInput } from "../../jalali-date-input";
import { formatJalaliDate, toIsoDate } from "../../jalali-date";
import { useAdminSession } from "../admin-session";

type Status = "UNDER_REVIEW" | "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED";
type Delivery = "PICKUP" | "COURIER";
type OrderSummary = { id: string; status: Status; deliveryMethod: Delivery; totalAmountToman: string; client: { firstName: string; lastName: string; phone: string } | null; createdAt: string };
type OrderDetail = OrderSummary & { paymentMethod: "OFFLINE"; deliveryAddressSnapshot: { label: string | null; addressLine: string } | null; customerNote: string | null; nextStatuses: Status[]; items: Array<{ id: string; itemName: string; variantName: string | null; unitPriceToman: string; quantity: number; lineTotalToman: string }> };
type OrdersResponse = { items: OrderSummary[]; total: number; page: number; pageSize: number };
type Settings = { pickupEnabled: boolean; courierEnabled: boolean; offlinePaymentEnabled: boolean };

const fa = new Intl.NumberFormat("fa-IR");
const labels: Record<Status, string> = { UNDER_REVIEW: "در حال بررسی", PREPARING: "در حال آماده‌سازی", READY: "آماده شده", OUT_FOR_DELIVERY: "در حال ارسال", DELIVERED: "تحویل داده شده" };
const deliveryLabels: Record<Delivery, string> = { PICKUP: "تحویل در کافه", COURIER: "تحویل با پیک" };

function toman(value: string) { return `${fa.format(Number(value))} تومان`; }
function phone(value?: string) { return value ? value.replace(/^\+98/, "0") : "ثبت نشده"; }
function today() { return toIsoDate(new Date()); }

export function OrdersAdmin() {
  const { access, api } = useAdminSession();
  const canRead = access.permissions.includes("orders.read");
  const canManage = access.permissions.includes("orders.manage");
  const [rows, setRows] = useState<OrderSummary[]>([]);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | "">("");
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());
  const [tab, setTab] = useState<"orders" | "settings">("orders");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!canRead) return;
    const query = new URLSearchParams({ pageSize: "20" });
    if (status) query.set("status", status);
    if (fromDate) query.set("fromDate", fromDate);
    if (toDate) query.set("toDate", toDate);
    const [orders, rules] = await Promise.all([api<OrdersResponse>(`/tenant/orders?${query}`), canManage ? api<Settings>("/tenant/ordering/settings").catch(() => null) : Promise.resolve(null)]);
    setRows(orders.items);
    setSettings(rules);
  }, [api, canManage, canRead, fromDate, status, toDate]);

  useEffect(() => { setBusy(true); load().catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false)); }, [load]);

  if (!canRead) return <section className="admin-section-state"><h1>سفارش‌ها</h1><p>نقش شما اجازه مشاهده سفارش‌های آنلاین این کافه را ندارد.</p></section>;

  async function filter(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await load(); setSelected(null); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  async function detail(id: string) { setBusy(true); setError(""); try { setSelected(await api<OrderDetail>(`/tenant/orders/${id}`)); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  async function transition(next: Status) { if (!selected) return; setBusy(true); setError(""); try { const item = await api<OrderDetail>(`/tenant/orders/${selected.id}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) }); setSelected(item); await load(); setNotice("وضعیت سفارش به‌روز شد."); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  async function saveSettings(event: FormEvent) { event.preventDefault(); if (!settings) return; setBusy(true); setError(""); try { setSettings(await api<Settings>("/tenant/ordering/settings", { method: "PATCH", body: JSON.stringify(settings) })); setNotice("تنظیمات سفارش آنلاین ذخیره شد."); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }

  return <section className="admin-reservations-shell admin-orders-shell"><header className="admin-page-heading"><div><h1>سفارش‌های آنلاین</h1><p>سفارش‌های مشتریان، روش تحویل و وضعیت آماده‌سازی را مدیریت کنید.</p></div></header>{canManage && <nav className="admin-tabs"><button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>سفارش‌ها</button><button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>تنظیمات</button></nav>}{error && <p className="admin-message error" role="alert">{error}</p>}{notice && <p className="admin-message success" role="status">{notice}</p>}{busy && !rows.length ? <div className="admin-inline-loading"><span className="admin-spinner" />در حال بارگذاری سفارش‌ها…</div> : tab === "orders" ? <div className="admin-workspace"><div><form className="reservation-filters" onSubmit={filter}><label>از تاریخ<JalaliDateInput value={fromDate} onChange={setFromDate} /></label><label>تا تاریخ<JalaliDateInput value={toDate} onChange={setToDate} /></label><label>وضعیت<select value={status} onChange={(event) => setStatus(event.target.value as Status | "")}><option value="">همه وضعیت‌ها</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button disabled={busy}>اعمال فیلتر</button></form><div className="reservation-list">{rows.map((row) => <button key={row.id} className={selected?.id === row.id ? "selected" : ""} onClick={() => detail(row.id)}><span><strong>{row.client ? `${row.client.firstName} ${row.client.lastName}` : "مشتری"}</strong><small>{formatJalaliDate(row.createdAt.slice(0, 10))} · {deliveryLabels[row.deliveryMethod]}</small></span><span><b className={`status-pill status-${row.status.toLowerCase()}`}>{labels[row.status]}</b><small>{toman(row.totalAmountToman)}</small></span></button>)}{!busy && !rows.length && <div className="admin-empty"><strong>سفارشی پیدا نشد</strong><p>فیلترها را تغییر دهید یا بعداً بررسی کنید.</p></div>}</div></div><aside className="reservation-detail">{selected ? <><div className="detail-title"><div><h2>{selected.client ? `${selected.client.firstName} ${selected.client.lastName}` : "مشتری"}</h2><small dir="ltr">{selected.id}</small></div><b className={`status-pill status-${selected.status.toLowerCase()}`}>{labels[selected.status]}</b></div><dl><div><dt>شماره همراه</dt><dd dir="ltr">{phone(selected.client?.phone)}</dd></div><div><dt>روش تحویل</dt><dd>{deliveryLabels[selected.deliveryMethod]}</dd></div><div><dt>روش پرداخت</dt><dd>پرداخت حضوری</dd></div><div><dt>مبلغ کل</dt><dd>{toman(selected.totalAmountToman)}</dd></div></dl>{selected.deliveryAddressSnapshot && <div className="detail-note"><strong>{selected.deliveryAddressSnapshot.label ?? "نشانی ارسال"}</strong><p>{selected.deliveryAddressSnapshot.addressLine}</p></div>}<div className="order-item-list">{selected.items.map((item) => <article key={item.id}><span><b>{item.itemName}</b><small>{item.variantName ?? "بدون اندازه"}</small></span><span>{fa.format(item.quantity)} × {toman(item.unitPriceToman)}</span><strong>{toman(item.lineTotalToman)}</strong></article>)}</div>{selected.customerNote && <div className="detail-note"><strong>یادداشت مشتری</strong><p>{selected.customerNote}</p></div>}{canManage && <div className="status-actions">{selected.nextStatuses.map((next) => <button key={next} disabled={busy} onClick={() => transition(next)}>{labels[next]}</button>)}</div>}</> : <div className="admin-empty"><strong>یک سفارش را انتخاب کنید</strong><p>جزئیات اینجا نمایش داده می‌شود.</p></div>}</aside></div> : settings ? <form className="reservation-settings" onSubmit={saveSettings}><div className="settings-heading"><div><h2>تنظیمات سفارش آنلاین</h2><p>روش‌های تحویل و پرداخت قابل انتخاب در تسویه.</p></div></div><div className="settings-grid"><label className="toggle"><input type="checkbox" checked={settings.offlinePaymentEnabled} onChange={(event) => setSettings({ ...settings, offlinePaymentEnabled: event.target.checked })} /><span>پرداخت حضوری فعال باشد</span></label><label className="toggle"><input type="checkbox" checked={settings.pickupEnabled} onChange={(event) => setSettings({ ...settings, pickupEnabled: event.target.checked })} /><span>تحویل در کافه فعال باشد</span></label><label className="toggle"><input type="checkbox" checked={settings.courierEnabled} onChange={(event) => setSettings({ ...settings, courierEnabled: event.target.checked })} /><span>تحویل با پیک فعال باشد</span></label></div><button disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره تنظیمات"}</button></form> : <div className="admin-empty"><strong>سفارش آنلاین برای این پلن فعال نیست</strong><p>برای تغییر تنظیمات، ماژول سفارش آنلاین را روی پلن فعال کنید.</p></div>}</section>;
}
