"use client";

import { Slide, ToastContainer, toast } from "react-toastify";

export function TenantToastContainer() {
  return <ToastContainer className="tenant-toast-container" toastClassName="tenant-toast" position="bottom-right" autoClose={4200} hideProgressBar newestOnTop closeOnClick={false} pauseOnHover rtl limit={3} transition={Slide} aria-label="اعلان‌های سبد خرید" />;
}

export function showAddedToCartToast(itemName: string, lineKey: string) {
  toast.success(<div className="tenant-toast-content"><div><strong>{itemName}</strong><span>به سبد خرید اضافه شد.</span></div><a href="/cart">مشاهده سبد خرید</a></div>, { toastId: `cart:${lineKey}`, icon: false, ariaLabel: `${itemName} به سبد خرید اضافه شد` });
}
