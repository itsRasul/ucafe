"use client";

export function CartIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4h2l1.7 10.1a2 2 0 0 0 2 1.7h7.9a2 2 0 0 0 1.9-1.4L21 7H6" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg>;
}

export function TrashIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>;
}

export function CartQuantityControl({ quantity, itemName, onIncrease, onDecrease, onRemove, className = "" }: { quantity: number; itemName: string; onIncrease: () => void; onDecrease: () => void; onRemove: () => void; className?: string }) {
  return <div className={`cart-quantity-control ${className}`.trim()} aria-label={`تعداد ${itemName}`}>
    <button type="button" onClick={onIncrease} disabled={quantity >= 20} aria-label={`افزایش تعداد ${itemName}`}><span aria-hidden="true">+</span></button>
    <span aria-live="polite">{new Intl.NumberFormat("fa-IR").format(quantity)}</span>
    {quantity === 1
      ? <button className="is-remove" type="button" onClick={onRemove} aria-label={`حذف ${itemName} از سبد خرید`}><TrashIcon /></button>
      : <button type="button" onClick={onDecrease} aria-label={`کاهش تعداد ${itemName}`}><span aria-hidden="true">−</span></button>}
  </div>;
}
