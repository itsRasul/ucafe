"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { clearCart, useResolvedCart } from "../cart-store";
import { ClientAuthForm, useClientSession } from "../client-session";
import { formatToman, type PublicMenu, type PublicOrderingState } from "../tenant-public";

type Address = { id: string; label: string | null; addressLine: string; isDefault: boolean };
type Order = { id: string; status: string; totalAmountToman: string; deliveryMethod: string; items: Array<{ itemName: string; variantName: string | null; quantity: number; lineTotalToman: string }> };

const deliveryLabel = { PICKUP: "تحویل در کافه", COURIER: "تحویل با پیک" } as const;

export function CheckoutClient({ menu, ordering }: { menu: PublicMenu; ordering: PublicOrderingState | null }) {
  const cart = useResolvedCart(menu);
  const session = useClientSession();
  const enabledDelivery = useMemo(() => ordering?.deliveryMethods.filter((method) => method.enabled) ?? [], [ordering]);
  const [deliveryMethod, setDeliveryMethod] = useState<"PICKUP" | "COURIER">(enabledDelivery[0]?.key ?? "PICKUP");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newAddressLabel, setNewAddressLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => { if (enabledDelivery[0]) setDeliveryMethod(enabledDelivery[0].key); }, [enabledDelivery]);
  useEffect(() => {
    if (!session.client) return;
    session.api<Address[]>("/public/client-addresses").then((items) => {
      setAddresses(items);
      setAddressId(items.find((item) => item.isDefault)?.id ?? items[0]?.id ?? "");
    }).catch(() => undefined);
  }, [session.client, session.api]);

  async function placeOrder(event: FormEvent) {
    event.preventDefault();
    if (!ordering?.onlineOrderingAvailable) { setError(ordering?.unavailableMessage ?? "امکان ثبت سفارش آنلاین برای این کافه در حال حاضر وجود ندارد."); return; }
    if (!cart.canCheckout) { setError("سبد خرید قابل تسویه نیست. آیتم‌های ناموجود را حذف کنید."); return; }
    if (deliveryMethod === "COURIER" && !addressId && newAddress.trim().length < 5) { setError("برای ارسال با پیک، نشانی را وارد کنید."); return; }
    setBusy(true); setError("");
    try {
      const result = await session.api<Order>("/public/orders", {
        method: "POST",
        body: JSON.stringify({
          items: cart.resolved.map((line) => ({ menuItemId: line.menuItemId, variantId: line.variantId ?? undefined, quantity: line.quantity })),
          paymentMethod: "OFFLINE",
          deliveryMethod,
          idempotencyKey: crypto.randomUUID(),
          ...(deliveryMethod === "COURIER" ? addressId ? { addressId } : { newAddress: { label: newAddressLabel || undefined, addressLine: newAddress, isDefault: !addresses.length } } : {}),
        }),
      });
      clearCart();
      setOrder(result);
    } catch (reason) {
      const body = (reason as { body?: { items?: Array<{ name?: string; reason: string }> } }).body;
      setError(body?.items?.length ? `برخی آیتم‌ها دیگر قابل سفارش نیستند: ${body.items.map((item) => item.name ?? item.reason).join("، ")}` : (reason as Error).message);
    } finally { setBusy(false); }
  }

  if (session.state === "loading") return <div className="admin-inline-loading"><span className="admin-spinner" />در حال بررسی نشست مشتری…</div>;
  if (order) return <section className="checkout-success" role="status"><h1>سفارش ثبت شد</h1><p>سفارش شما با شماره <bdi dir="ltr">{order.id.slice(0, 8)}</bdi> در وضعیت «در حال بررسی» ثبت شد.</p><strong>{formatToman(order.totalAmountToman)}</strong><a href="/menu">بازگشت به منو</a></section>;
  if (!session.client) return <ClientAuthForm session={session} title="ورود برای تسویه" registerTitle="ساخت حساب برای تسویه" detail="برای ثبت سفارش، وارد شوید یا یک حساب مشتری بسازید. سبد خرید شما حفظ می‌شود." />;

  return <section className="checkout-shell" aria-labelledby="checkout-title">
    <header className="cart-heading"><div><h1 id="checkout-title">تسویه سفارش</h1><p>{session.client.firstName} عزیز، سفارش را نهایی کنید.</p></div><a className="text-button" href="/cart">بازگشت به سبد</a></header>
    {error && <p className="form-message error" role="alert">{error}</p>}
    <form className="checkout-layout" onSubmit={placeOrder}>
      <div className="checkout-main">
        <section className="checkout-panel"><h2>روش پرداخت</h2><label className="checkout-option locked"><input type="radio" checked readOnly /> پرداخت حضوری</label></section>
        <section className="checkout-panel"><h2>روش تحویل</h2>{enabledDelivery.length ? enabledDelivery.map((method) => <label className="checkout-option" key={method.key}><input type="radio" name="delivery" checked={deliveryMethod === method.key} onChange={() => setDeliveryMethod(method.key)} /> {deliveryLabel[method.key]}</label>) : <p className="form-message error">هیچ روش تحویلی برای این کافه فعال نیست.</p>}{deliveryMethod === "PICKUP" && <p className="checkout-address-hint">{ordering?.deliveryMethods.find((method) => method.key === "PICKUP")?.address ?? "نشانی کافه هنوز ثبت نشده است."}</p>}</section>
        {deliveryMethod === "COURIER" && <section className="checkout-panel"><h2>نشانی ارسال</h2>{addresses.length > 0 && <div className="checkout-address-list">{addresses.map((address) => <label className="checkout-option" key={address.id}><input type="radio" name="address" checked={addressId === address.id} onChange={() => setAddressId(address.id)} /><span><strong>{address.label ?? "نشانی ذخیره‌شده"}</strong><small>{address.addressLine}</small></span></label>)}</div>}<label>نشانی جدید<textarea value={newAddress} onChange={(event) => { setNewAddress(event.target.value); if (event.target.value.trim()) setAddressId(""); }} maxLength={700} placeholder="خیابان، پلاک، واحد و توضیحات لازم" /></label><label>برچسب نشانی <small>اختیاری</small><input value={newAddressLabel} onChange={(event) => setNewAddressLabel(event.target.value)} maxLength={80} placeholder="خانه، محل کار…" /></label></section>}
      </div>
      <aside className="cart-summary checkout-summary"><h2>خلاصه سفارش</h2>{cart.resolved.map((line) => <div className="checkout-line" key={`${line.menuItemId}:${line.variantId ?? ""}`}><span>{line.item?.name}{line.variant ? `، ${line.variant.name}` : ""}</span><b>{new Intl.NumberFormat("fa-IR").format(line.quantity)} × {line.unitPriceToman ? formatToman(line.unitPriceToman) : "—"}</b></div>)}<dl><div><dt>مبلغ کل</dt><dd>{formatToman(String(cart.totalToman))}</dd></div></dl><button className="cart-checkout" disabled={busy || !cart.canCheckout || !enabledDelivery.length}>{busy ? "در حال ثبت…" : "ثبت سفارش"}</button></aside>
    </form>
  </section>;
}
