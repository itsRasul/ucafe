"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearCart, useResolvedCart } from "../cart-store";
import { TrashIcon } from "../cart-controls";
import { useClientSession } from "../client-session";
import { formatToman, type PublicMenu, type PublicOrderingState } from "../tenant-public";

type Address = { id: string; label: string | null; province: string | null; city: string | null; addressLine: string; buildingNumber: string | null; unit: string | null; postalCode: string | null; isDefault: boolean };
type AddressLike = { province: string | null; city: string | null; addressLine: string; buildingNumber: string | null; unit: string | null };
type NewAddress = { label: string; province: string; city: string; addressLine: string; buildingNumber: string; unit: string; postalCode: string };
const emptyAddress: NewAddress = { label: "", province: "", city: "", addressLine: "", buildingNumber: "", unit: "", postalCode: "" };
const deliveryLabel = { PICKUP: "تحویل در کافه", COURIER: "ارسال با پیک" } as const;

function PaymentIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16v11H4zM7 4h10v3M7 12h3M15 12h2M7 16h10" /></svg>; }
function PickupIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 20V9h14v11M3 9l2-5h14l2 5M8 13h8M9 20v-4h6v4" /></svg>; }
function CourierIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg>; }
function NoteIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></svg>; }
function PinIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></svg>; }
function EditIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4Z" /><path d="m14 6 4 4" /></svg>; }

function addressText(address: AddressLike) {
  return [[address.province, address.city].filter(Boolean).join("، "), address.addressLine, address.buildingNumber ? `پلاک ${address.buildingNumber}` : "", address.unit ? `واحد ${address.unit}` : ""].filter(Boolean).join("، ");
}

export function CheckoutClient({ menu, ordering }: { menu: PublicMenu; ordering: PublicOrderingState | null }) {
  const router = useRouter();
  const cart = useResolvedCart(menu);
  const session = useClientSession();
  const enabledDelivery = useMemo(() => ordering?.deliveryMethods.filter((method) => method.enabled) ?? [], [ordering]);
  const [deliveryMethod, setDeliveryMethod] = useState<"PICKUP" | "COURIER">(enabledDelivery[0]?.key ?? "PICKUP");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState("");
  const [addingAddress, setAddingAddress] = useState(false);
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState<NewAddress>(emptyAddress);
  const [customerNote, setCustomerNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addressModal, setAddressModal] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => { if (enabledDelivery[0]) setDeliveryMethod(enabledDelivery[0].key); }, [enabledDelivery]);
  useEffect(() => { if (session.state === "ready" && !session.client) router.replace("/cart?auth=checkout"); }, [session.state, session.client, router]);
  useEffect(() => {
    if (!session.client) return;
    session.api<Address[]>("/public/client-addresses").then((items) => {
      setAddresses(items); setAddressId(items.find((item) => item.isDefault)?.id ?? items[0]?.id ?? ""); setAddingAddress(!items.length);
    }).catch(() => setError("دریافت نشانی‌های ذخیره‌شده ممکن نشد."));
  }, [session.client, session.api]);
  useEffect(() => { if (addressModal) requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>("button, a, input")?.focus()); }, [addressModal]);

  const selectedAddress = addresses.find((item) => item.id === addressId) ?? (!addressId && [newAddress.province, newAddress.city, newAddress.addressLine, newAddress.buildingNumber].some((value) => value.trim()) ? newAddress : null);

  function openAddressModal() {
    setError("");
    if (!addressId) { setAddingAddress(true); setEditingAddress(null); }
    setAddressModal(true);
  }

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { setAddressModal(false); return; }
    if (event.key !== "Tab") return;
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    if (!controls.length) return;
    const first = controls[0]; const last = controls.at(-1)!;
    if (!first) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function removeAddress(address: Address) {
    if (!confirm(`نشانی «${address.label ?? "ذخیره‌شده"}» حذف شود؟`)) return;
    setBusy(true); setError("");
    try {
      await session.api(`/public/client-addresses/${address.id}`, { method: "DELETE" });
      const remaining = addresses.filter((item) => item.id !== address.id);
      setAddresses(remaining);
      if (addressId === address.id) setAddressId(remaining.find((item) => item.isDefault)?.id ?? remaining[0]?.id ?? "");
      if (!remaining.length) setAddingAddress(true);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function editAddress(address: Address) {
    setAddressId(address.id); setEditingAddress(address.id); setAddingAddress(true);
    setNewAddress({ label: address.label ?? "", province: address.province ?? "", city: address.city ?? "", addressLine: address.addressLine, buildingNumber: address.buildingNumber ?? "", unit: address.unit ?? "", postalCode: address.postalCode ?? "" });
  }

  async function saveEditedAddress() {
    if (!editingAddress) return;
    setBusy(true); setError("");
    try {
      const saved = await session.api<Address>(`/public/client-addresses/${editingAddress}`, { method: "PATCH", body: JSON.stringify({ ...newAddress, label: newAddress.label.trim() || undefined, unit: newAddress.unit.trim() || undefined, postalCode: newAddress.postalCode || undefined }) });
      setAddresses(addresses.map((item) => item.id === saved.id ? saved : item)); setAddingAddress(false); setEditingAddress(null);
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  function confirmNewAddress() {
    if (editingAddress) { void saveEditedAddress(); return; }
    if (!newAddress.province.trim() || !newAddress.city.trim() || newAddress.addressLine.trim().length < 5 || !newAddress.buildingNumber.trim()) { setError("استان، شهر، نشانی و پلاک را کامل کنید."); return; }
    if (newAddress.postalCode && !/^\d{10}$/.test(newAddress.postalCode)) { setError("کدپستی باید دقیقاً ۱۰ رقم باشد."); return; }
    setError(""); setAddingAddress(false); setAddressModal(false);
  }

  async function placeOrder(event: FormEvent) {
    event.preventDefault();
    if (!ordering?.onlineOrderingAvailable) { setError(ordering?.unavailableMessage ?? "امکان ثبت سفارش آنلاین برای این کافه در حال حاضر وجود ندارد."); return; }
    if (!cart.canCheckout) { setError("سبد خرید قابل تسویه نیست. آیتم‌های ناموجود را حذف کنید."); return; }
    if (deliveryMethod === "COURIER" && !addressId && (!newAddress.province.trim() || !newAddress.city.trim() || newAddress.addressLine.trim().length < 5 || !newAddress.buildingNumber.trim())) { setError("استان، شهر، نشانی و پلاک را کامل کنید."); return; }
    if (newAddress.postalCode && !/^\d{10}$/.test(newAddress.postalCode)) { setError("کدپستی باید دقیقاً ۱۰ رقم باشد."); return; }
    setBusy(true); setError("");
    try {
      const result = await session.api<{ id: string }>("/public/orders", {
        method: "POST", body: JSON.stringify({
          items: cart.resolved.map((line) => ({ menuItemId: line.menuItemId, variantId: line.variantId ?? undefined, quantity: line.quantity })), paymentMethod: "OFFLINE", deliveryMethod, idempotencyKey: crypto.randomUUID(), customerNote: customerNote.trim() || undefined,
          ...(deliveryMethod === "COURIER" ? addressId ? { addressId } : { newAddress: { ...newAddress, label: newAddress.label.trim() || undefined, unit: newAddress.unit.trim() || undefined, postalCode: newAddress.postalCode || undefined, isDefault: !addresses.length } } : {}),
        })
      });
      clearCart(); router.replace(`/checkout/result?order=${result.id}`);
    } catch (reason) {
      const body = (reason as { body?: { items?: Array<{ name?: string; reason: string }> } }).body;
      setError(body?.items?.length ? `برخی آیتم‌ها دیگر قابل سفارش نیستند: ${body.items.map((item) => item.name ?? item.reason).join("، ")}` : (reason as Error).message);
    } finally { setBusy(false); }
  }

  if (session.state === "loading" || !session.client) return <div className="checkout-route-loading" aria-live="polite"><span className="admin-spinner" />در حال بررسی حساب مشتری…</div>;

  return <section className="checkout-shell" aria-labelledby="checkout-title">
    <header className="checkout-overview"><div><span>مرحله نهایی سفارش</span><h1 id="checkout-title">اطلاعات سفارش خود را تکمیل کنید</h1><p>{session.client.firstName} عزیز، روش تحویل و جزئیات سفارش را پیش از ثبت نهایی بررسی کنید.</p></div><dl><div className="checkout-overview-box"><dt>تعداد محصولات</dt><dd>{new Intl.NumberFormat("fa-IR").format(cart.count)}</dd></div><div className="checkout-overview-box"><dt>مبلغ نهایی</dt><dd>{formatToman(String(cart.totalToman))}</dd></div></dl></header>
    {error && <p className="form-message error checkout-error" role="alert">{error}</p>}
    <form className="checkout-layout" onSubmit={placeOrder}>
      <div className="checkout-main">
        <section className="checkout-panel"><div className="checkout-panel-heading"><PaymentIcon /><div><h2>روش پرداخت</h2><p>هزینه سفارش هنگام تحویل دریافت می‌شود.</p></div></div><label className="checkout-option selected locked"><input type="radio" checked readOnly /><span><strong>پرداخت در محل</strong><small>پرداخت در محل کافه یا هنگام دریافت از پیک</small></span></label></section>
        <section className="checkout-panel"><div className="checkout-panel-heading"><CourierIcon /><div><h2>نحوه دریافت سفارش</h2><p>یکی از روش‌های فعال کافه را انتخاب کنید.</p></div></div><div className="checkout-delivery-options">{enabledDelivery.length ? enabledDelivery.map((method) => <label className={`checkout-option ${deliveryMethod === method.key ? "selected" : ""}`} key={method.key}><input type="radio" name="delivery" checked={deliveryMethod === method.key} onChange={() => setDeliveryMethod(method.key)} /><span className="checkout-option-icon">{method.key === "PICKUP" ? <PickupIcon /> : <CourierIcon />}</span><span><strong>{deliveryLabel[method.key]}</strong><small>{method.key === "PICKUP" ? "سفارش را از کافه تحویل می‌گیرید" : "سفارش به نشانی شما ارسال می‌شود"}</small></span></label>) : <p className="form-message error">هیچ روش تحویلی برای این کافه فعال نیست.</p>}</div>{deliveryMethod === "COURIER" && <button className={"checkout-address-summary" + (selectedAddress ? "" : " empty")} type="button" onClick={openAddressModal}><span className="checkout-address-summary-head"><strong>{selectedAddress ? "ارسال به آدرس انتخاب شده" : "ارسال با پیک"}</strong><span className="checkout-address-summary-change">{selectedAddress ? "تغییر آدرس" : "افزودن آدرس"} <span aria-hidden="true">‹</span></span></span><span className="checkout-address-summary-body"><CourierIcon /><span>{selectedAddress ? addressText(selectedAddress) : "آدرس خود را وارد نمایید"}</span></span></button>}{deliveryMethod === "PICKUP" && <p className="checkout-address-hint">{ordering?.deliveryMethods.find((method) => method.key === "PICKUP")?.address ?? "نشانی کافه هنوز ثبت نشده است."}</p>}</section>
        <section className="checkout-panel"><div className="checkout-panel-heading"><NoteIcon /><div><h2>یادداشت سفارش</h2><p>اگر نکته‌ای برای آماده‌سازی دارید، اینجا بنویسید.</p></div></div><label>توضیحات <small>اختیاری</small><textarea value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} maxLength={500} placeholder="مثلاً غذا تند نباشد" /></label><small className="checkout-character-count">{new Intl.NumberFormat("fa-IR").format(customerNote.length)} از ۵۰۰</small></section>
      </div>
      <aside className="cart-summary checkout-summary"><div><h2>سفارش شما</h2><p>مرور نهایی پیش از ثبت سفارش</p></div><div className="checkout-lines">{cart.resolved.map((line) => <div className="checkout-line" key={`${line.menuItemId}:${line.variantId ?? ""}`}><span>{line.item?.name}{line.variant ? `، ${line.variant.name}` : ""}</span><b>{new Intl.NumberFormat("fa-IR").format(line.quantity)} × {line.unitPriceToman ? formatToman(line.unitPriceToman) : "—"}</b></div>)}</div><dl><div><dt>مجموع سفارش</dt><dd>{formatToman(String(cart.totalToman))}</dd></div><div className="cart-summary-total"><dt>مبلغ نهایی</dt><dd>{formatToman(String(cart.totalToman))}</dd></div></dl><button className="cart-checkout" disabled={busy || !cart.canCheckout || !enabledDelivery.length}>{busy ? "در حال ثبت…" : "ثبت نهایی سفارش"}</button><a className="checkout-back-cart" href="/cart">بازگشت به سبد خرید</a></aside>
    </form>
    {addressModal && <div className="tenant-modal-backdrop checkout-auth-backdrop" role="presentation" onMouseDown={() => setAddressModal(false)}>
      <div className="checkout-auth-modal checkout-address-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-address-title" ref={dialog} onKeyDown={trapFocus} onMouseDown={(event) => event.stopPropagation()}>
        <header className="checkout-address-head">
          <h2 id="checkout-address-title">انتخاب آدرس</h2>
          <button className="checkout-modal-close" type="button" aria-label="بستن انتخاب آدرس" onClick={() => setAddressModal(false)}>×</button>
        </header>
        <div className="checkout-address-body">
          {error && <p className="form-message error" role="alert">{error}</p>}
          {addresses.length > 0 && <p className="checkout-address-section">آدرس‌های من</p>}
          {addresses.length > 0 && <div className="checkout-address-list">{addresses.map((address) => <div className={"checkout-address-card" + (addressId === address.id ? " selected" : "")} key={address.id}>
            <label>
              <input className="sr-only" type="radio" name="address" checked={addressId === address.id} onChange={() => { setAddressId(address.id); setAddingAddress(false); setEditingAddress(null); setAddressModal(false); }} />
              <span className="checkout-address-pin"><PinIcon /></span>
              <span className="checkout-address-copy"><strong>{address.label ?? "نشانی ذخیره‌شده"}</strong><small>{addressText(address)}</small></span>
            </label>
            <span className="checkout-address-actions">
              <button type="button" disabled={busy} aria-label="ویرایش نشانی" onClick={() => editAddress(address)}><EditIcon /></button>
              <button type="button" disabled={busy} aria-label="حذف نشانی" onClick={() => removeAddress(address)}><TrashIcon /></button>
            </span>
          </div>)}</div>}
          {!addingAddress && <button className="checkout-add-address" type="button" onClick={() => { setAddingAddress(true); setEditingAddress(null); setAddressId(""); setNewAddress(emptyAddress); }}><span aria-hidden="true">+</span>افزودن آدرس جدید</button>}
          {addingAddress && <div className="checkout-address-form">
            <label>عنوان نشانی <small>اختیاری</small><input value={newAddress.label} onChange={(event) => setNewAddress({ ...newAddress, label: event.target.value })} maxLength={80} placeholder="خانه یا محل کار" /></label>
            <label>استان<input value={newAddress.province} onChange={(event) => setNewAddress({ ...newAddress, province: event.target.value })} maxLength={80} required={!addressId} /></label>
            <label>شهر<input value={newAddress.city} onChange={(event) => setNewAddress({ ...newAddress, city: event.target.value })} maxLength={80} required={!addressId} /></label>
            <label>نشانی دقیق<textarea value={newAddress.addressLine} onChange={(event) => setNewAddress({ ...newAddress, addressLine: event.target.value })} maxLength={700} minLength={5} required={!addressId} placeholder="خیابان، کوچه و توضیحات دسترسی" /></label>
            <label>پلاک<input value={newAddress.buildingNumber} onChange={(event) => setNewAddress({ ...newAddress, buildingNumber: event.target.value })} maxLength={20} required={!addressId} /></label>
            <label>واحد <small>اختیاری</small><input value={newAddress.unit} onChange={(event) => setNewAddress({ ...newAddress, unit: event.target.value })} maxLength={20} /></label>
            <label>کدپستی <small>اختیاری</small><input dir="ltr" inputMode="numeric" value={newAddress.postalCode} onChange={(event) => setNewAddress({ ...newAddress, postalCode: event.target.value.replace(/\D/g, "").slice(0, 10) })} pattern="\d{10}" /></label>
            <div className="checkout-address-form-actions">
              {editingAddress && <button className="text-button" type="button" disabled={busy} onClick={() => { setAddingAddress(false); setEditingAddress(null); }}>انصراف</button>}
              <button className="checkout-address-save" type="button" disabled={busy} onClick={confirmNewAddress}>{editingAddress ? "ذخیره تغییرات" : "تأیید و انتخاب آدرس"}</button>
            </div>
          </div>}
        </div>
      </div>
    </div>}
  </section>;
}
