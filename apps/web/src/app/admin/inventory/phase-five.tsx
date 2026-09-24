"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAdminSession } from "../admin-session";
import "./inventory.css";

type Page<T> = { items: T[]; page: number; limit: number; total: number };
type Item = { id: string; name: string; dimension: string; baseUnit: string; isActive: boolean };
type Location = { id: string; name: string; isActive: boolean };
export type PhaseFiveStock = {
  itemId: string; name: string; dimension: string; baseUnit: string; isActive: boolean;
  locationId: string; locationName: string; quantityBase: string; quantity: string; unit: string;
  minimumQuantityBase: string | null; parQuantityBase: string | null; minimumQuantity: string | null; parQuantity: string | null;
  onOrderQuantityBase: string; onOrderQuantity: string; projectedQuantityBase: string; projectedQuantity: string;
  parGapBase: string | null; parGap: string | null; projectedParGapBase: string | null; projectedParGap: string | null;
  stockStatus: string | null;
};
type WasteLine = { id?: string; itemId: string; itemName?: string; quantity: string; unit: string; quantityBase?: string; movementId?: string | null; totalCostToman?: string | null };
type WasteRecord = { id: string; locationId: string; locationName: string; wastedAt: string; reason: string; note: string | null; status: "DRAFT" | "POSTED" | "REVERSED"; createdByUserId: string | null; itemCount: number; estimatedCostToman: string | null; unknownCostItemCount: number; items?: WasteLine[] };
type WasteForm = { locationId: string; reason: string; wastedAt: string; note: string; items: Array<{ inventoryItemId: string; quantity: string; unit: string }> };
type Alert = { id: string; itemId: string; itemName: string; baseUnit: string; unit: string; locationId: string; locationName: string; type: string; status: string; openedAt: string; resolvedAt: string | null; quantity: string; minimumQuantity: string | null; parQuantity: string | null };

const reasons: Record<string, string> = { EXPIRED: "تاریخ‌گذشته", DAMAGED: "خرابی", SPILLED: "ریختن و هدررفت", PREPARATION_ERROR: "اشتباه در آماده‌سازی", CUSTOMER_RETURN: "برگشتی مشتری", QUALITY_ISSUE: "مشکل کیفیت", OVERPRODUCTION: "تولید بیش از نیاز", STAFF_USE: "مصرف داخلی", TRAINING: "آموزش کارکنان", OTHER: "سایر" };
const units: Record<string, string> = { g: "گرم", kg: "کیلوگرم", ml: "میلی‌لیتر", l: "لیتر", piece: "عدد", pack: "بسته", box: "جعبه", bottle: "بطری" };
const statusNames: Record<string, string> = { DRAFT: "پیش‌نویس", POSTED: "ثبت نهایی", REVERSED: "اصلاح‌شده" };
const alertNames: Record<string, string> = { NEGATIVE: "موجودی منفی", OUT_OF_STOCK: "ناموجود", LOW_STOCK: "موجودی کم" };
const stockNames: Record<string, string> = { NEGATIVE: "موجودی منفی", OUT_OF_STOCK: "ناموجود", LOW_STOCK: "موجودی کم", BELOW_PAR: "زیر موجودی هدف", OK: "موجودی مناسب" };
const decimal = (value: string | number) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 6 }).format(Number(value));
const money = (value: string) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Number(value));
const localInputDate = (value: string | Date = new Date()) => { const date = new Date(typeof value === "string" ? value : value.getTime()); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); };
const emptyWasteForm = (locationId: string): WasteForm => ({ locationId, reason: "EXPIRED", wastedAt: localInputDate(), note: "", items: [{ inventoryItemId: "", quantity: "1", unit: "" }] });
const dimensionUnits = (item?: Item) => item?.dimension === "WEIGHT" ? ["g", "kg"] : item?.dimension === "VOLUME" ? ["ml", "l"] : item ? [item.baseUnit] : [];
const unitFactor: Record<string, bigint> = { g: BigInt(1), kg: BigInt(1000), ml: BigInt(1), l: BigInt(1000) };
const scale = BigInt(1_000_000);
function micros(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  const result = BigInt(match[2]!) * scale + BigInt((match[3] ?? "").padEnd(6, "0") || "0");
  return match[1] ? -result : result;
}
function inputBaseMicros(value: string, unit: string, baseUnit: string) {
  const amount = micros(value), from = unitFactor[unit] ?? BigInt(1), to = unitFactor[baseUnit] ?? BigInt(1);
  if (amount === null || amount * from % to !== BigInt(0)) return null;
  return amount * from / to;
}
function formatMicros(value: bigint) { const abs = value < BigInt(0) ? -value : value; const fraction = (abs % scale).toString().padStart(6, "0").replace(/0+$/, ""); return `${value < BigInt(0) ? "-" : ""}${abs / scale}${fraction ? `.${fraction}` : ""}`; }
function convertQuantity(value: string, from: string, to: string, baseUnit: string) {
  const base = inputBaseMicros(value, from, baseUnit), fromFactor = unitFactor[baseUnit] ?? BigInt(1), toFactor = unitFactor[to] ?? BigInt(1);
  if (base === null || base * fromFactor % toFactor !== BigInt(0)) return null;
  return formatMicros(base * fromFactor / toFactor);
}

export function StockSettingsDialog({ row, close, saved }: { row: PhaseFiveStock; close: () => void; saved: () => void }) {
  const { api } = useAdminSession();
  const [unit, setUnit] = useState(row.unit || row.baseUnit);
  const [minimum, setMinimum] = useState(row.minimumQuantity ?? "");
  const [par, setPar] = useState(row.parQuantity ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choices = dimensionUnits({ id: row.itemId, name: row.name, dimension: row.dimension, baseUnit: row.baseUnit, isActive: row.isActive });
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api(`/tenant/inventory/items/${row.itemId}/stock-settings`, { method: "PATCH", body: JSON.stringify({ locationId: row.locationId, unit, minimumQuantity: minimum || null, parQuantity: par || null }) });
      saved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "ذخیره حد موجودی انجام نشد."); }
    finally { setBusy(false); }
  }
  return <div className="inventory-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><form className="inventory-dialog" onSubmit={(event) => void save(event)}>
    <button type="button" className="inventory-dialog-close" onClick={close} aria-label="بستن">×</button><h2>حد موجودی {row.name}</h2><p>{row.locationName} · حداقل موجودی با عبور موجودی از آن هشدار می‌دهد؛ موجودی هدف مقدار معمول نگهداری است.</p>
    <label>واحد تنظیم<select value={unit} onChange={(event) => { const nextUnit = event.target.value; const nextMinimum = minimum ? convertQuantity(minimum, unit, nextUnit, row.baseUnit) : ""; const nextPar = par ? convertQuantity(par, unit, nextUnit, row.baseUnit) : ""; if (nextMinimum === null || nextPar === null) { setError("مقدار فعلی با این واحد دقیق نیست؛ واحد دیگری انتخاب کنید."); return; } setUnit(nextUnit); setMinimum(nextMinimum); setPar(nextPar); setError(""); }}>{choices.map((choice) => <option key={choice} value={choice}>{units[choice]}</option>)}</select></label>
    <label>حداقل موجودی<input inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="اختیاری"/></label>
    <small>اگر موجودی به این مقدار یا کمتر برسد، هشدار کمبود نمایش داده می‌شود.</small>
    <label>موجودی هدف (PAR)<input inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" value={par} onChange={(event) => setPar(event.target.value)} placeholder="اختیاری"/></label>
    <small>مقداری که معمولاً می‌خواهید از این کالا در این محل داشته باشید.</small>
    {error && <p className="inventory-alert" role="alert">{error}</p>}
    <div className="inventory-actions"><button type="button" className="inventory-secondary" onClick={close}>انصراف</button><button className="inventory-primary" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره حد موجودی"}</button></div>
  </form></div>;
}

export function WastePanel({ items, locations, canManage, changed }: { items: Item[]; locations: Location[]; canManage: boolean; changed: () => void }) {
  const { api } = useAdminSession();
  const [records, setRecords] = useState<Page<WasteRecord>>({ items: [], page: 1, limit: 25, total: 0 });
  const [selected, setSelected] = useState<WasteRecord | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<WasteForm | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(""); const [reason, setReason] = useState(""); const [location, setLocation] = useState(""); const [search, setSearch] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [stockByItem, setStockByItem] = useState<Record<string, string>>({});
  const itemKey = useMemo(() => [...new Set((form?.items ?? []).map((line) => line.inventoryItemId).filter(Boolean))].sort().join(","), [form?.items]);
  const load = useCallback(async () => {
    const query = new URLSearchParams({ limit: "25", page: String(page) });
    if (status) query.set("status", status); if (reason) query.set("reason", reason); if (location) query.set("locationId", location); if (search.trim()) query.set("search", search.trim()); if (from) query.set("from", from); if (to) query.set("to", to);
    setError("");
    try { setRecords(await api<Page<WasteRecord>>(`/tenant/inventory/waste?${query}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "دریافت سوابق ضایعات انجام نشد."); }
  }, [api, page, status, reason, location, search, from, to]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    const ids = itemKey ? itemKey.split(",") : [];
    if (!form?.locationId || !ids.length) { setStockByItem({}); return; }
    void Promise.all(ids.map(async (id) => { const result = await api<Page<PhaseFiveStock>>(`/tenant/inventory/stock?itemId=${id}&locationId=${form.locationId}&active=true&limit=1&page=1`); return [id, result.items[0]?.quantityBase ?? "0"] as const; }))
      .then((rows) => { if (!cancelled) setStockByItem(Object.fromEntries(rows)); }).catch(() => { if (!cancelled) setStockByItem({}); });
    return () => { cancelled = true; };
  }, [api, form?.locationId, itemKey]);
  async function open(id: string) { setError(""); try { setSelected(await api<WasteRecord>(`/tenant/inventory/waste/${id}`)); } catch (cause) { setError(cause instanceof Error ? cause.message : "ضایعات پیدا نشد."); } }
  function newRecord() { setSelected(null); setEditing(null); setForm(emptyWasteForm(locations.find((entry) => entry.isActive)?.id ?? "")); }
  async function editRecord(record: WasteRecord) {
    try {
      const detail = await api<WasteRecord>(`/tenant/inventory/waste/${record.id}`); setSelected(detail); setEditing(detail.id);
      setForm({ locationId: detail.locationId, reason: detail.reason, wastedAt: localInputDate(detail.wastedAt), note: detail.note ?? "", items: (detail.items ?? []).map((line) => ({ inventoryItemId: line.itemId, quantity: line.quantity, unit: line.unit })) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "پیش‌نویس باز نشد."); }
  }
  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!form) return; setBusy(true); setError("");
    try {
      const body = { ...form, wastedAt: new Date(form.wastedAt).toISOString(), note: form.note || null };
      const record = await api<WasteRecord>(`/tenant/inventory/waste${editing ? `/${editing}` : ""}`, { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) });
      setSelected(record); setEditing(record.id); setForm(null); setNotice("پیش‌نویس ضایعات ذخیره شد."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ذخیره ضایعات انجام نشد."); }
    finally { setBusy(false); }
  }
  async function post(record: WasteRecord) {
    setBusy(true); setError("");
    try { setSelected(await api<WasteRecord>(`/tenant/inventory/waste/${record.id}/post`, { method: "POST" })); setNotice("ضایعات ثبت نهایی شد و موجودی به‌روز شد."); await load(); changed(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ثبت نهایی ضایعات انجام نشد."); }
    finally { setBusy(false); }
  }
  async function reverse(record: WasteRecord) {
    if (!window.confirm("تمام اقلام این ثبت به موجودی بازگردانده و سابقه ضایعات حفظ می‌شود. ادامه می‌دهید؟")) return;
    setBusy(true); setError("");
    try { setSelected(await api<WasteRecord>(`/tenant/inventory/waste/${record.id}/reverse`, { method: "POST" })); setNotice("اصلاح ضایعات ثبت شد؛ سابقه اصلی حفظ شده است."); await load(); changed(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "اصلاح ضایعات انجام نشد."); }
    finally { setBusy(false); }
  }
  function changeLine(index: number, values: Partial<WasteForm["items"][number]>) {
    if (!form) return; const lines = [...form.items]; lines[index] = { ...lines[index]!, ...values }; setForm({ ...form, items: lines });
  }
  function warning(line: WasteForm["items"][number]) {
    const item = items.find((entry) => entry.id === line.inventoryItemId); const current = stockByItem[line.inventoryItemId];
    if (!item || current === undefined || !line.quantity) return false;
    const stock = micros(current), amount = inputBaseMicros(line.quantity, line.unit, item.baseUnit);
    return stock !== null && amount !== null && stock - amount < BigInt(0);
  }
  return <div className="inventory-phase5-layout">
    <section className="inventory-panel">
      <div className="inventory-panel-head"><div><h2>سوابق ضایعات</h2><p>ثبت‌های ضایعات، هزینه تقریبی موجودی و وضعیت هر ثبت.</p></div>{canManage && <button className="inventory-primary" onClick={newRecord}>＋ ثبت ضایعات</button>}</div>
      <div className="inventory-filters"><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="جست‌وجوی کالا یا یادداشت" aria-label="جست‌وجوی ضایعات"/><select value={reason} onChange={(event) => { setReason(event.target.value); setPage(1); }}><option value="">همه دلایل</option>{Object.entries(reasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={location} onChange={(event) => { setLocation(event.target.value); setPage(1); }}><option value="">همه محل‌ها</option>{locations.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">همه وضعیت‌ها</option><option value="DRAFT">پیش‌نویس</option><option value="POSTED">ثبت نهایی</option><option value="REVERSED">اصلاح‌شده</option></select><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} aria-label="از تاریخ"/><input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} aria-label="تا تاریخ"/></div>
      <div className="inventory-item-list">{records.items.map((record) => <article key={record.id} className={selected?.id === record.id ? "selected" : ""}><button className="purchase-select" onClick={() => void open(record.id)}><strong>{new Date(record.wastedAt).toLocaleDateString("fa-IR")} · {reasons[record.reason] ?? record.reason}</strong><small>{record.locationName} · {decimal(record.itemCount)} قلم · {record.estimatedCostToman !== null ? `${money(record.estimatedCostToman)} تومان هزینه تقریبی` : "هزینه نامشخص"}</small></button><span className={`inventory-status-badge status-${record.status.toLowerCase()}`}>{statusNames[record.status]}</span></article>)}{!records.items.length && <p className="purchase-empty">ضایعاتی برای این فیلتر پیدا نشد.</p>}</div>
      <div className="inventory-actions"><button className="inventory-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>قبلی</button><span>{decimal(records.page)} از {decimal(Math.max(1, Math.ceil(records.total / records.limit)))}</span><button className="inventory-secondary" disabled={page * records.limit >= records.total} onClick={() => setPage(page + 1)}>بعدی</button></div>
    </section>
    <section className="inventory-panel">
      {form && canManage ? <><div className="inventory-panel-head"><div><h2>{editing ? "ویرایش پیش‌نویس ضایعات" : "ثبت ضایعات"}</h2><p>مقدار را با واحد سازگار کالا وارد کنید؛ ثبت نهایی موجودی را کاهش می‌دهد.</p></div><button className="inventory-secondary" onClick={() => { setForm(null); setEditing(null); }}>بستن</button></div>
        <form className="inventory-form" onSubmit={(event) => void saveDraft(event)}><label>محل<select required value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })}><option value="">انتخاب محل</option>{locations.filter((entry) => entry.isActive).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label>دلیل<select required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })}>{Object.entries(reasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>تاریخ و زمان<input required type="datetime-local" value={form.wastedAt} onChange={(event) => setForm({ ...form, wastedAt: event.target.value })}/></label><label className="inventory-wide">یادداشت اختیاری<input maxLength={1000} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })}/></label>
          <div className="inventory-waste-lines"><h3>اقلام ضایعات</h3>{form.items.map((line, index) => { const item = items.find((entry) => entry.id === line.inventoryItemId); return <div className="inventory-waste-line" key={index}><label>کالا<select required value={line.inventoryItemId} onChange={(event) => { const picked = items.find((entry) => entry.id === event.target.value); changeLine(index, { inventoryItemId: event.target.value, unit: picked?.baseUnit ?? "" }); }}><option value="">انتخاب کالا</option>{items.filter((entry) => entry.isActive).map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {units[entry.baseUnit]}</option>)}</select></label><label>مقدار<input required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" value={line.quantity} onChange={(event) => changeLine(index, { quantity: event.target.value })}/></label><label>واحد<select required value={line.unit} onChange={(event) => changeLine(index, { unit: event.target.value })}><option value="">انتخاب</option>{dimensionUnits(item).map((unit) => <option key={unit} value={unit}>{units[unit]}</option>)}</select></label><button type="button" className="purchase-remove" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, row) => row !== index) })}>حذف</button>{warning(line) && <small className="inventory-waste-warning">این ثبت، موجودی {item?.name} را منفی می‌کند.</small>}</div>; })}<button type="button" className="inventory-secondary" onClick={() => setForm({ ...form, items: [...form.items, { inventoryItemId: "", quantity: "1", unit: "" }] })}>＋ افزودن قلم</button></div>
          {error && <p className="inventory-alert" role="alert">{error}</p>}<button className="inventory-primary" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره پیش‌نویس"}</button>
        </form></> : selected ? <><div className="inventory-panel-head"><div><span className={`inventory-status-badge status-${selected.status.toLowerCase()}`}>{statusNames[selected.status]}</span><h2>{reasons[selected.reason] ?? selected.reason} · {new Date(selected.wastedAt).toLocaleString("fa-IR")}</h2><p>{selected.locationName}{selected.note ? ` · ${selected.note}` : ""}</p></div></div><div className="purchase-detail-lines">{(selected.items ?? []).map((line) => <article key={line.id}><strong>{line.itemName}</strong><span>{decimal(line.quantity)} {units[line.unit] ?? line.unit}</span><small>{line.totalCostToman !== null && line.totalCostToman !== undefined ? `${money(line.totalCostToman)} تومان هزینه تقریبی موجودی` : line.movementId ? "هزینه در زمان ثبت در دسترس نبود" : "ثبت نهایی نشده"}</small></article>)}{!selected.items?.length && <p className="purchase-empty">این پیش‌نویس قلمی ندارد.</p>}</div>{selected.status === "POSTED" && selected.unknownCostItemCount > 0 && <p className="inventory-muted">هزینه {decimal(selected.unknownCostItemCount)} قلم به‌دلیل نبود بهای میانگین در زمان ثبت نامشخص است.</p>}{canManage && <div className="inventory-actions">{selected.status === "DRAFT" && <><button className="inventory-secondary" disabled={busy} onClick={() => void editRecord(selected)}>ویرایش پیش‌نویس</button><button className="inventory-primary" disabled={busy} onClick={() => void post(selected)}>ثبت نهایی و کاهش موجودی</button></>}{selected.status === "POSTED" && <button className="inventory-secondary" disabled={busy} onClick={() => void reverse(selected)}>اصلاح کامل ثبت</button>}</div>}</> : <div><h2>جزئیات ضایعات</h2><p className="purchase-empty">برای مشاهده جزئیات، یک ثبت را انتخاب کنید یا ضایعات تازه‌ای ثبت کنید.</p></div>}
      {error && !form && <p className="inventory-alert" role="alert">{error}</p>}{notice && <p className="inventory-notice" role="status">{notice}</p>}
    </section>
  </div>;
}

export function StockAlertsPanel({ items, locations }: { items: Item[]; locations: Location[] }) {
  const { api } = useAdminSession();
  const [status, setStatus] = useState("OPEN"); const [itemId, setItemId] = useState(""); const [locationId, setLocationId] = useState("");
  const [page, setPage] = useState<Page<Alert>>({ items: [], page: 1, limit: 50, total: 0 }); const [error, setError] = useState("");
  const load = useCallback(async () => {
    const query = new URLSearchParams({ status, limit: "50", page: String(page.page) }); if (itemId) query.set("itemId", itemId); if (locationId) query.set("locationId", locationId);
    try { setPage(await api<Page<Alert>>(`/tenant/inventory/stock-alerts?${query}`)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "دریافت هشدارها انجام نشد."); }
  }, [api, status, itemId, locationId, page.page]);
  useEffect(() => { void load(); }, [load]);
  return <section className="inventory-panel"><div className="inventory-panel-head"><div><h2>هشدارهای موجودی</h2><p>هشدار تا زمان اصلاح موجودی باز می‌ماند و با هر حرکت تکرار نمی‌شود.</p></div></div><div className="inventory-filters"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage((current) => ({ ...current, page: 1 })); }}><option value="OPEN">باز</option><option value="RESOLVED">رفع‌شده</option><option value="ALL">همه</option></select><select value={itemId} onChange={(event) => { setItemId(event.target.value); setPage((current) => ({ ...current, page: 1 })); }}><option value="">همه کالاها</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={locationId} onChange={(event) => { setLocationId(event.target.value); setPage((current) => ({ ...current, page: 1 })); }}><option value="">همه محل‌ها</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>{error && <p className="inventory-alert" role="alert">{error}</p>}
    <div className="inventory-table-scroll" tabIndex={0}><table className="inventory-table"><thead><tr><th>کالا</th><th>محل</th><th>وضعیت</th><th>موجودی فعلی</th><th>حداقل</th><th>زمان بازشدن</th><th>رفع‌شدن</th></tr></thead><tbody>{page.items.map((alert) => <tr key={alert.id}><td><strong>{alert.itemName}</strong></td><td>{alert.locationName}</td><td><span className={`inventory-status-badge ${alert.status === "OPEN" ? "status-open" : "status-resolved"}`}>{alertNames[alert.type] ?? alert.type}</span></td><td className={alert.type === "NEGATIVE" ? "negative-stock" : ""}>{decimal(alert.quantity)} {units[alert.unit] ?? alert.unit}</td><td>{alert.minimumQuantity === null ? "—" : `${decimal(alert.minimumQuantity)} ${units[alert.unit] ?? alert.unit}`}</td><td>{new Date(alert.openedAt).toLocaleString("fa-IR")}</td><td>{alert.resolvedAt ? new Date(alert.resolvedAt).toLocaleString("fa-IR") : "—"}</td></tr>)}{!page.items.length && <tr><td colSpan={7}>هشداری برای این فیلتر وجود ندارد.</td></tr>}</tbody></table></div>
    <div className="inventory-actions"><button className="inventory-secondary" disabled={page.page <= 1} onClick={() => setPage((current) => ({ ...current, page: current.page - 1 }))}>قبلی</button><span>{decimal(page.page)} از {decimal(Math.max(1, Math.ceil(page.total / page.limit)))}</span><button className="inventory-secondary" disabled={page.page * page.limit >= page.total} onClick={() => setPage((current) => ({ ...current, page: current.page + 1 }))}>بعدی</button></div>
  </section>;
}
