"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAdminSession } from "../../admin-session";
import "../inventory.css";

type Page<T> = { items: T[]; page: number; limit: number; total: number };
type Supplier = { id: string; name: string; contactPerson: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null; isActive: boolean };
type SupplierPrice = { inventoryItemId: string; itemName: string; baseUnit: string; quantity: string; unit: string; unitPriceToman: string; receiptNumber: string; receivedAt: string };
type Item = { id: string; name: string; dimension: "WEIGHT" | "VOLUME" | "COUNT"; baseUnit: string; isActive: boolean };
type Location = { id: string; name: string; isDefault: boolean; isActive: boolean };
type OrderLine = { id: string; inventoryItemId: string; itemName: string; dimension: Item["dimension"]; baseUnit: string; quantity: string; unit: string; quantityBase: string; unitPriceToman: string; receivedQuantityBase: string; remainingQuantityBase: string; remainingQuantity: string; note: string | null };
type Order = { id: string; number: string; supplierId: string; supplierName: string; status: string; orderDate: string; expectedDeliveryDate: string | null; notes: string | null; estimatedTotalToman: string; items: OrderLine[]; receipts: Array<{ id: string; number: string; status: string }> };
type ReceiptLine = { id: string; purchaseOrderItemId: string | null; inventoryItemId: string; itemName: string; baseUnit: string; locationId: string; locationName: string; quantity: string; unit: string; quantityBase: string; unitPriceToman: string; totalCostToman: string; note: string | null; movementId: string | null };
type Receipt = { id: string; number: string; status: "DRAFT" | "POSTED"; overReceiveConfirmed: boolean; supplierId: string; supplierName: string; purchaseOrderId: string | null; purchaseOrderNumber: string | null; supplierInvoiceNumber: string | null; deliveryNoteNumber: string | null; notes: string | null; totalCostToman?: string; items: ReceiptLine[] };
type LineForm = { inventoryItemId: string; purchaseOrderItemId?: string; quantity: string; unit: string; unitPriceToman: string; locationId?: string; note?: string };
type Tab = "suppliers" | "orders" | "receipts";
const units: Record<string, string[]> = { WEIGHT: ["g", "kg"], VOLUME: ["ml", "l"], COUNT: ["piece", "pack", "box", "bottle"] };
const unitName: Record<string, string> = { g: "گرم", kg: "کیلوگرم", ml: "میلی‌لیتر", l: "لیتر", piece: "عدد", pack: "بسته", box: "جعبه", bottle: "بطری" };
const statusName: Record<string, string> = { DRAFT: "پیش‌نویس", ORDERED: "سفارش‌شده", PARTIALLY_RECEIVED: "دریافت بخشی", RECEIVED: "دریافت کامل", CANCELED: "لغوشده", POSTED: "ثبت نهایی" };
const fa = (value: string | number) => new Intl.NumberFormat("fa-IR").format(Number(value));
const quantity = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, "٬").replace(/\./g, "٫").replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);
const money = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, "٬").replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);
const emptyLine = (): LineForm => ({ inventoryItemId: "", quantity: "1", unit: "piece", unitPriceToman: "0" });

export default function PurchasingPage() {
  const { access, api } = useAdminSession();
  const canRead = access.permissions.includes("inventory.read") || access.permissions.includes("inventory.manage");
  const canManage = access.permissions.includes("inventory.manage");
  const [tab, setTab] = useState<Tab>("orders");
  const [suppliers, setSuppliers] = useState<Page<Supplier>>({ items: [], page: 1, limit: 50, total: 0 });
  const [orders, setOrders] = useState<Page<Order>>({ items: [], page: 1, limit: 25, total: 0 });
  const [receipts, setReceipts] = useState<Page<Receipt>>({ items: [], page: 1, limit: 25, total: 0 });
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [orderPage, setOrderPage] = useState(1);
  const [receiptPage, setReceiptPage] = useState(1);
  const [supplierPage, setSupplierPage] = useState(1);
  const [supplierPrices, setSupplierPrices] = useState<{ supplierId: string; items: SupplierPrice[] } | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [supplierEdit, setSupplierEdit] = useState<Supplier | null>(null);
  const [orderFormOpen, setOrderFormOpen] = useState(false);
  const [orderEdit, setOrderEdit] = useState<Order | null>(null);
  const [receiptFormOpen, setReceiptFormOpen] = useState(false);
  const [receiptEdit, setReceiptEdit] = useState<Receipt | null>(null);
  const [orderForm, setOrderForm] = useState({ supplierId: "", expectedDeliveryDate: "", notes: "", items: [emptyLine()] as LineForm[] });
  const [receiptForm, setReceiptForm] = useState({ purchaseOrderId: "", supplierId: "", supplierInvoiceNumber: "", deliveryNoteNumber: "", notes: "", items: [emptyLine()] as LineForm[] });

  const load = useCallback(async () => {
    if (!canRead || access.features?.inventory === false) return;
    setBusy(true); setError("");
    try {
      const [s, o, r, firstItemPage, loc] = await Promise.all([
        api<Page<Supplier>>(`/tenant/inventory/suppliers?limit=50&page=${supplierPage}`),
        api<Page<Order>>(`/tenant/inventory/purchase-orders?limit=25&page=${orderPage}`),
        api<Page<Receipt>>(`/tenant/inventory/goods-receipts?limit=25&page=${receiptPage}`),
        api<Page<Item>>("/tenant/inventory/items?limit=100&page=1&active=true"),
        api<Location[]>("/tenant/inventory/locations"),
      ]);
      const extraItems = await Promise.all(Array.from({ length: Math.ceil(firstItemPage.total / firstItemPage.limit) - 1 }, (_, index) => api<Page<Item>>(`/tenant/inventory/items?limit=100&page=${index + 2}&active=true`)));
      setSuppliers(s); setOrders(o); setReceipts(r); setItems([firstItemPage, ...extraItems].flatMap((itemPage) => itemPage.items)); setLocations(loc);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "دریافت اطلاعات خرید ممکن نشد."); }
    finally { setBusy(false); }
  }, [access.features?.inventory, api, canRead, orderPage, receiptPage, supplierPage]);
  useEffect(() => { void load(); }, [load]);

  async function openOrder(id: string) {
    setError("");
    try { setSelectedOrder(await api<Order>(`/tenant/inventory/purchase-orders/${id}`)); }
    catch (reason) { setError((reason as Error).message); }
  }
  async function openReceipt(id: string) {
    setError("");
    try { setSelectedReceipt(await api<Receipt>(`/tenant/inventory/goods-receipts/${id}`)); }
    catch (reason) { setError((reason as Error).message); }
  }
  async function showSupplierPrices(id: string) {
    try { const result = await api<Page<SupplierPrice>>(`/tenant/inventory/suppliers/${id}/prices?limit=100&page=1`); setSupplierPrices({ supplierId: id, items: result.items }); }
    catch (reason) { setError((reason as Error).message); }
  }
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(message); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "عملیات انجام نشد."); }
    finally { setBusy(false); }
  }

  function beginReceive(order: Order) {
    setSelectedOrder(order); setSelectedReceipt(null); setReceiptEdit(null);
    setReceiptForm({ purchaseOrderId: order.id, supplierId: order.supplierId, supplierInvoiceNumber: "", deliveryNoteNumber: "", notes: "", items: order.items.filter((line) => Number(line.remainingQuantityBase) > 0).map((line) => ({ inventoryItemId: line.inventoryItemId, purchaseOrderItemId: line.id, quantity: line.remainingQuantity, unit: line.unit, unitPriceToman: line.unitPriceToman, locationId: locations.find((location) => location.isDefault && location.isActive)?.id })) });
    setReceiptFormOpen(true); setTab("receipts");
  }

  function lineEditor(lines: LineForm[], update: (lines: LineForm[]) => void, receipt = false) {
    return <div className="purchase-lines">{lines.map((line, index) => {
      const item = items.find((entry) => entry.id === line.inventoryItemId);
      const choices = item ? (item.dimension === "COUNT" ? [item.baseUnit] : units[item.dimension] ?? [item.baseUnit]) : ["piece"];
      return <div className="purchase-line" key={`${line.purchaseOrderItemId ?? line.inventoryItemId}-${index}`}>
        <label>کالا<select required value={line.inventoryItemId} disabled={Boolean(line.purchaseOrderItemId)} onChange={(event) => { const next = [...lines]; const picked = items.find((entry) => entry.id === event.target.value); next[index] = { ...line, inventoryItemId: event.target.value, unit: picked?.baseUnit ?? "piece" }; update(next); }}><option value="">انتخاب کالا</option>{items.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {unitName[entry.baseUnit]}</option>)}</select></label>
        <label>مقدار<input required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" value={line.quantity} onChange={(event) => { const next = [...lines]; next[index] = { ...line, quantity: event.target.value }; update(next); }} /></label>
        <label>واحد<select value={line.unit} disabled={Boolean(line.purchaseOrderItemId)} onChange={(event) => { const next = [...lines]; next[index] = { ...line, unit: event.target.value }; update(next); }}>{choices.map((unit) => <option key={unit} value={unit}>{unitName[unit]}</option>)}</select></label>
        <label>قیمت هر واحد (تومان)<input required inputMode="numeric" pattern="[0-9]+" value={line.unitPriceToman} onChange={(event) => { const next = [...lines]; next[index] = { ...line, unitPriceToman: event.target.value }; update(next); }} /></label>
        {receipt && <label>محل دریافت<select value={line.locationId ?? ""} onChange={(event) => { const next = [...lines]; next[index] = { ...line, locationId: event.target.value || undefined }; update(next); }}><option value="">محل پیش‌فرض</option>{locations.filter((location) => location.isActive).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
        <button type="button" className="purchase-remove" aria-label="حذف ردیف" disabled={Boolean(line.purchaseOrderItemId) || lines.length === 1} onClick={() => update(lines.filter((_, row) => row !== index))}>حذف</button>
        {item && <small className="purchase-normalized">مقدار با واحد پایه {unitName[item.baseUnit]} ذخیره می‌شود.</small>}
      </div>;
    })}<button type="button" className="inventory-secondary" onClick={() => update([...lines, emptyLine()])}>＋ افزودن ردیف</button></div>;
  }

  async function saveSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const body = Object.fromEntries(["name", "contactPerson", "phone", "email", "address", "notes"].map((key) => [key, String(data.get(key) ?? "").trim()]).filter(([, value]) => value));
    await run(async () => { await api(`/tenant/inventory/suppliers${supplierEdit ? `/${supplierEdit.id}` : ""}`, { method: supplierEdit ? "PATCH" : "POST", body: JSON.stringify(body) }); setSupplierEdit(null); }, supplierEdit ? "تأمین‌کننده ویرایش شد." : "تأمین‌کننده افزوده شد.");
  }

  async function saveOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { supplierId: orderForm.supplierId, expectedDeliveryDate: orderForm.expectedDeliveryDate || undefined, notes: orderForm.notes || undefined, items: orderForm.items };
    await run(async () => {
      const path = `/tenant/inventory/purchase-orders${orderEdit ? `/${orderEdit.id}` : ""}`;
      const saved = await api<Order>(path, { method: orderEdit ? "PATCH" : "POST", body: JSON.stringify(body) });
      setOrderFormOpen(false); setOrderEdit(null); setSelectedOrder(saved); setOrderForm({ supplierId: "", expectedDeliveryDate: "", notes: "", items: [emptyLine()] });
    }, orderEdit ? "پیش‌نویس سفارش خرید ذخیره شد." : "پیش‌نویس سفارش خرید ایجاد شد.");
  }

  async function saveReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { ...(receiptForm.purchaseOrderId ? { purchaseOrderId: receiptForm.purchaseOrderId } : { supplierId: receiptForm.supplierId }), supplierInvoiceNumber: receiptForm.supplierInvoiceNumber || undefined, deliveryNoteNumber: receiptForm.deliveryNoteNumber || undefined, notes: receiptForm.notes || undefined, items: receiptForm.items };
    await run(async () => {
      const path = `/tenant/inventory/goods-receipts${receiptEdit ? `/${receiptEdit.id}` : ""}`;
      const saved = await api<Receipt>(path, { method: receiptEdit ? "PATCH" : "POST", body: JSON.stringify(body) });
      setSelectedReceipt(saved); setReceiptFormOpen(false); setReceiptEdit(null); setReceiptForm({ purchaseOrderId: "", supplierId: "", supplierInvoiceNumber: "", deliveryNoteNumber: "", notes: "", items: [emptyLine()] });
    }, "پیش‌نویس رسید ذخیره شد.");
  }

  async function postReceipt(receipt: Receipt) {
    const send = (allowOverReceive: boolean) => api(`/tenant/inventory/goods-receipts/${receipt.id}/post`, { method: "POST", body: JSON.stringify({ allowOverReceive }) });
    try { await send(false); setNotice("رسید نهایی شد و موجودی به‌روزرسانی شد."); }
    catch (reason) {
      if ((reason as Error).message.includes("exceeds the remaining ordered quantity") && window.confirm("مقدار دریافتی از باقی‌مانده سفارش بیشتر است. مقدار واقعی کالا را ثبت می‌کنید؟")) {
        try { await send(true); setNotice("دریافت بیش از سفارش با تأیید شما ثبت شد."); }
        catch (retry) { setError((retry as Error).message); return; }
      } else { setError((reason as Error).message); return; }
    }
    await openReceipt(receipt.id); await load();
  }

  if (access.features?.inventory === false || !canRead) return <section className="inventory-state"><span>موجودی و خرید</span><h1>خرید و تأمین کالا</h1><p>اشتراک یا دسترسی نقش شما امکان استفاده از موجودی را نمی‌دهد.</p><Link href="/admin">بازگشت به پنل</Link></section>;

  return <section className="inventory-page">
    <header className="inventory-heading"><div><span>موجودی و خرید</span><h1>تأمین‌کنندگان و خرید</h1><p>سفارش کالا، ثبت دریافت واقعی و نگهداری تاریخچه قیمت.</p></div><Link className="inventory-secondary" href="/admin/inventory">بازگشت به موجودی</Link></header>
    <nav className="inventory-tabs" aria-label="بخش‌های خرید"><button aria-current={tab === "orders" ? "page" : undefined} onClick={() => setTab("orders")}>سفارش‌های خرید</button><button aria-current={tab === "receipts" ? "page" : undefined} onClick={() => setTab("receipts")}>دریافت کالا</button><button aria-current={tab === "suppliers" ? "page" : undefined} onClick={() => setTab("suppliers")}>تأمین‌کنندگان</button></nav>
    {error && <p className="inventory-alert" role="alert">{error}</p>}{notice && <p className="inventory-notice" role="status">{notice}</p>}

    {tab === "suppliers" && <div className="inventory-columns"><section className="inventory-panel"><div className="inventory-panel-head"><div><h2>تأمین‌کنندگان</h2><p>غیرفعال‌سازی سوابق قبلی خرید را نگه می‌دارد.</p></div></div>{!suppliers.items.length && <p className="purchase-empty">تأمین‌کننده‌ای ثبت نشده است.</p>}{suppliers.items.map((supplier) => <article className="purchase-card" key={supplier.id}><div><strong>{supplier.name}</strong><small>{supplier.contactPerson || ""} {supplier.phone || ""} {supplier.email || ""}</small><small>{supplier.isActive ? "فعال" : "غیرفعال"}</small></div><div className="purchase-card-actions"><button className="inventory-link-button" onClick={() => void showSupplierPrices(supplier.id)}>آخرین قیمت‌ها</button>{canManage && <><button className="inventory-link-button" onClick={() => setSupplierEdit(supplier)}>ویرایش</button><button className="inventory-link-button" onClick={() => void run(() => api(`/tenant/inventory/suppliers/${supplier.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !supplier.isActive }) }), supplier.isActive ? "تأمین‌کننده غیرفعال شد." : "تأمین‌کننده فعال شد.")}>{supplier.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}</button></>}</div></article>)}{supplierPrices && suppliers.items.some((supplier) => supplier.id === supplierPrices.supplierId) && <section className="purchase-prices"><h3>آخرین قیمت‌های ثبت‌شده</h3>{supplierPrices.items.map((price) => <p key={price.inventoryItemId}><strong>{price.itemName}</strong><span>{money(price.unitPriceToman)} تومان / {unitName[price.unit]} · {price.receiptNumber}</span></p>)}{!supplierPrices.items.length && <small>هنوز رسید نهایی برای این تأمین‌کننده ثبت نشده است.</small>}</section>}<div className="inventory-actions"><button className="inventory-secondary" disabled={supplierPage <= 1} onClick={() => setSupplierPage(supplierPage - 1)}>قبلی</button><span>{fa(supplierPage)} از {fa(Math.max(1, Math.ceil(suppliers.total / suppliers.limit)))}</span><button className="inventory-secondary" disabled={supplierPage * suppliers.limit >= suppliers.total} onClick={() => setSupplierPage(supplierPage + 1)}>بعدی</button></div></section>
      {canManage && <section className="inventory-panel"><h2>{supplierEdit ? "ویرایش تأمین‌کننده" : "افزودن تأمین‌کننده"}</h2><form className="inventory-form" key={supplierEdit?.id ?? "new"} onSubmit={(event) => void saveSupplier(event)}><label>نام تأمین‌کننده<input name="name" required maxLength={140} defaultValue={supplierEdit?.name ?? ""}/></label><label>نام رابط<input name="contactPerson" maxLength={140} defaultValue={supplierEdit?.contactPerson ?? ""}/></label><label>تلفن<input name="phone" dir="ltr" maxLength={40} defaultValue={supplierEdit?.phone ?? ""}/></label><label>ایمیل<input name="email" type="email" maxLength={254} defaultValue={supplierEdit?.email ?? ""}/></label><label className="inventory-wide">نشانی<input name="address" maxLength={500} defaultValue={supplierEdit?.address ?? ""}/></label><label className="inventory-wide">یادداشت<input name="notes" maxLength={1000} defaultValue={supplierEdit?.notes ?? ""}/></label><button className="inventory-primary" disabled={busy}>{supplierEdit ? "ذخیره تغییرات" : "افزودن تأمین‌کننده"}</button>{supplierEdit && <button type="button" className="inventory-secondary" onClick={() => setSupplierEdit(null)}>انصراف</button>}</form></section>}</div>}

    {tab === "orders" && <div className="purchase-layout"><section className="inventory-panel"><div className="inventory-panel-head"><div><h2>سفارش‌های خرید</h2><p>ایجاد سفارش موجودی را تغییر نمی‌دهد.</p></div>{canManage && <button className="inventory-primary" onClick={() => { setOrderEdit(null); setOrderFormOpen(!orderFormOpen); }}>＋ سفارش جدید</button>}</div>{orders.items.map((order) => <article className={`purchase-card ${selectedOrder?.id === order.id ? "selected" : ""}`} key={order.id}><button className="purchase-select" onClick={() => void openOrder(order.id)}><strong>{order.number} · {order.supplierName}</strong><small>{statusName[order.status]} · {money(order.estimatedTotalToman)} تومان برآورد</small></button></article>)}{!orders.items.length && <p className="purchase-empty">سفارشی پیدا نشد.</p>}<div className="inventory-actions"><button className="inventory-secondary" disabled={orderPage <= 1} onClick={() => setOrderPage(orderPage - 1)}>قبلی</button><span>{fa(orderPage)} از {fa(Math.max(1, Math.ceil(orders.total / orders.limit)))}</span><button className="inventory-secondary" disabled={orderPage * orders.limit >= orders.total} onClick={() => setOrderPage(orderPage + 1)}>بعدی</button></div></section>
      <section className="inventory-panel">{orderFormOpen && canManage ? <><div className="inventory-panel-head"><div><h2>{orderEdit ? `ویرایش ${orderEdit.number}` : "پیش‌نویس سفارش"}</h2><p>واحد و قیمت تخمینی هر قلم را ثبت کنید.</p></div><button className="inventory-secondary" onClick={() => { setOrderFormOpen(false); setOrderEdit(null); }}>بستن</button></div><form className="purchase-form" onSubmit={(event) => void saveOrder(event)}><label>تأمین‌کننده<select required value={orderForm.supplierId} onChange={(event) => setOrderForm({ ...orderForm, supplierId: event.target.value })}><option value="">انتخاب تأمین‌کننده</option>{suppliers.items.filter((supplier) => supplier.isActive).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label>تاریخ تحویل مورد انتظار<input type="date" value={orderForm.expectedDeliveryDate} onChange={(event) => setOrderForm({ ...orderForm, expectedDeliveryDate: event.target.value })}/></label><label>یادداشت<input maxLength={1000} value={orderForm.notes} onChange={(event) => setOrderForm({ ...orderForm, notes: event.target.value })}/></label>{lineEditor(orderForm.items, (items) => setOrderForm({ ...orderForm, items }))}<button className="inventory-primary" disabled={busy}>ذخیره پیش‌نویس</button></form></> : selectedOrder ? <><div className="purchase-detail-head"><div><span>{statusName[selectedOrder.status]}</span><h2>{selectedOrder.number}</h2><p>{selectedOrder.supplierName} · برآورد {money(selectedOrder.estimatedTotalToman)} تومان</p></div><small>{selectedOrder.expectedDeliveryDate ? new Date(`${selectedOrder.expectedDeliveryDate}T00:00:00`).toLocaleDateString("fa-IR") : "بدون تاریخ تحویل"}</small></div><div className="purchase-detail-lines">{selectedOrder.items.map((line) => <article key={line.id}><strong>{line.itemName}</strong><span>سفارش {quantity(line.quantity)} {unitName[line.unit]} · دریافت {quantity(line.receivedQuantityBase)} {unitName[line.baseUnit]}</span><small>باقی‌مانده {quantity(line.remainingQuantity)} {unitName[line.unit]} · {money(line.unitPriceToman)} تومان / {unitName[line.unit]}</small></article>)}</div>{selectedOrder.receipts.length > 0 && <p className="purchase-receipt-links">رسیدها: {selectedOrder.receipts.map((receipt) => <button className="inventory-link-button" key={receipt.id} onClick={() => { setTab("receipts"); void openReceipt(receipt.id); }}>{receipt.number} · {statusName[receipt.status]}</button>)}</p>}<div className="inventory-actions">{canManage && selectedOrder.status === "DRAFT" && <><button className="inventory-secondary" onClick={() => { setOrderEdit(selectedOrder); setOrderForm({ supplierId: selectedOrder.supplierId, expectedDeliveryDate: selectedOrder.expectedDeliveryDate ?? "", notes: selectedOrder.notes ?? "", items: selectedOrder.items.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: line.quantity, unit: line.unit, unitPriceToman: line.unitPriceToman, note: line.note ?? undefined })) }); setOrderFormOpen(true); }}>ویرایش</button><button className="inventory-primary" disabled={busy} onClick={() => void run(async () => setSelectedOrder(await api<Order>(`/tenant/inventory/purchase-orders/${selectedOrder.id}/order`, { method: "POST" })), "سفارش برای تأمین‌کننده ثبت شد.")}>ثبت سفارش</button></>}{canManage && ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(selectedOrder.status) && <button className="inventory-primary" onClick={() => beginReceive(selectedOrder)}>ثبت دریافت کالا</button>}{canManage && ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"].includes(selectedOrder.status) && <button className="inventory-secondary" onClick={() => void run(async () => setSelectedOrder(await api<Order>(`/tenant/inventory/purchase-orders/${selectedOrder.id}/cancel`, { method: "POST" })), "سفارش لغو شد؛ دریافت‌های قبلی حفظ شدند.")}>لغو سفارش</button>}</div></> : <p className="purchase-empty">برای مشاهده جزئیات، یک سفارش را انتخاب کنید.</p>}</section></div>}

    {tab === "receipts" && <div className="purchase-layout"><section className="inventory-panel"><div className="inventory-panel-head"><div><h2>رسیدهای کالا</h2><p>فقط ثبت نهایی رسید، موجودی و بهای میانگین را تغییر می‌دهد.</p></div>{canManage && <button className="inventory-primary" onClick={() => { setReceiptEdit(null); setReceiptForm({ purchaseOrderId: "", supplierId: "", supplierInvoiceNumber: "", deliveryNoteNumber: "", notes: "", items: [emptyLine()] }); setReceiptFormOpen(true); }}>＋ دریافت مستقیم</button>}</div>{receipts.items.map((receipt) => <article className={`purchase-card ${selectedReceipt?.id === receipt.id ? "selected" : ""}`} key={receipt.id}><button className="purchase-select" onClick={() => void openReceipt(receipt.id)}><strong>{receipt.number} · {receipt.supplierName}</strong><small>{receipt.purchaseOrderNumber ? `${receipt.purchaseOrderNumber} · ` : "دریافت مستقیم · "}{statusName[receipt.status]} · {receipt.totalCostToman ? `${money(receipt.totalCostToman)} تومان` : "پیش‌نویس"}</small></button></article>)}{!receipts.items.length && <p className="purchase-empty">رسیدی ثبت نشده است.</p>}<div className="inventory-actions"><button className="inventory-secondary" disabled={receiptPage <= 1} onClick={() => setReceiptPage(receiptPage - 1)}>قبلی</button><span>{fa(receiptPage)} از {fa(Math.max(1, Math.ceil(receipts.total / receipts.limit)))}</span><button className="inventory-secondary" disabled={receiptPage * receipts.limit >= receipts.total} onClick={() => setReceiptPage(receiptPage + 1)}>بعدی</button></div></section>
      <section className="inventory-panel">{receiptFormOpen && canManage ? <><div className="inventory-panel-head"><div><h2>{receiptEdit ? `ویرایش ${receiptEdit.number}` : receiptForm.purchaseOrderId ? "ثبت رسید سفارش" : "دریافت مستقیم"}</h2><p>قیمت واقعی فاکتور را وارد کنید؛ موجودی پس از ثبت نهایی افزایش می‌یابد.</p></div><button className="inventory-secondary" onClick={() => { setReceiptFormOpen(false); setReceiptEdit(null); }}>بستن</button></div><form className="purchase-form" onSubmit={(event) => void saveReceipt(event)}>{!receiptForm.purchaseOrderId && <label>تأمین‌کننده<select required value={receiptForm.supplierId} onChange={(event) => setReceiptForm({ ...receiptForm, supplierId: event.target.value })}><option value="">انتخاب تأمین‌کننده</option>{suppliers.items.filter((supplier) => supplier.isActive).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>}<label>شماره فاکتور<input maxLength={100} value={receiptForm.supplierInvoiceNumber} onChange={(event) => setReceiptForm({ ...receiptForm, supplierInvoiceNumber: event.target.value })}/></label><label>شماره حواله<input maxLength={100} value={receiptForm.deliveryNoteNumber} onChange={(event) => setReceiptForm({ ...receiptForm, deliveryNoteNumber: event.target.value })}/></label><label>یادداشت<input maxLength={1000} value={receiptForm.notes} onChange={(event) => setReceiptForm({ ...receiptForm, notes: event.target.value })}/></label>{lineEditor(receiptForm.items, (items) => setReceiptForm({ ...receiptForm, items }), true)}<button className="inventory-primary" disabled={busy}>ذخیره پیش‌نویس رسید</button></form></> : selectedReceipt ? <><div className="purchase-detail-head"><div><span>{statusName[selectedReceipt.status]}{selectedReceipt.overReceiveConfirmed ? " · دریافت بیش از سفارش با تأیید" : ""}</span><h2>{selectedReceipt.number}</h2><p>{selectedReceipt.supplierName}{selectedReceipt.purchaseOrderNumber ? ` · ${selectedReceipt.purchaseOrderNumber}` : " · دریافت مستقیم"}</p></div><small>{selectedReceipt.supplierInvoiceNumber ? `فاکتور ${selectedReceipt.supplierInvoiceNumber}` : "بدون شماره فاکتور"}</small></div><div className="purchase-detail-lines">{selectedReceipt.items.map((line) => <article key={line.id}><strong>{line.itemName}</strong><span>{quantity(line.quantity)} {unitName[line.unit]} · {line.locationName}</span><small>{money(line.unitPriceToman)} تومان / {unitName[line.unit]} · جمع {money(line.totalCostToman)} تومان</small></article>)}</div>{canManage && selectedReceipt.status === "DRAFT" && <div className="inventory-actions"><button className="inventory-secondary" onClick={() => { setReceiptEdit(selectedReceipt); setReceiptForm({ purchaseOrderId: selectedReceipt.purchaseOrderId ?? "", supplierId: selectedReceipt.supplierId, supplierInvoiceNumber: selectedReceipt.supplierInvoiceNumber ?? "", deliveryNoteNumber: selectedReceipt.deliveryNoteNumber ?? "", notes: selectedReceipt.notes ?? "", items: selectedReceipt.items.map((line) => ({ inventoryItemId: line.inventoryItemId, purchaseOrderItemId: line.purchaseOrderItemId ?? undefined, quantity: line.quantity, unit: line.unit, unitPriceToman: line.unitPriceToman, locationId: line.locationId, note: line.note ?? undefined })) }); setReceiptFormOpen(true); }}>ویرایش پیش‌نویس</button><button className="inventory-primary" disabled={busy} onClick={() => void postReceipt(selectedReceipt)}>ثبت نهایی و افزایش موجودی</button></div>}</> : <p className="purchase-empty">برای دیدن جزئیات، یک رسید را انتخاب کنید.</p>}</section></div>}
    {busy && <p className="inventory-loading" role="status">در حال ذخیره یا دریافت اطلاعات…</p>}
  </section>;
}
