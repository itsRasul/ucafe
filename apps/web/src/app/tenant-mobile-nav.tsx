"use client";

import { useEffect, useState } from "react";

export function TenantMobileNav({ sectionPrefix = "" }: { sectionPrefix?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [open]);
  const links = [
    { href: `${sectionPrefix}#about`, label: "درباره ما" },
    { href: "/menu", label: "منو" },
    { href: `${sectionPrefix}#gallery`, label: "گالری" },
    { href: `${sectionPrefix}#visit`, label: "تماس و نشانی" },
    { href: "/login", label: "ورود / ثبت‌نام" },
    { href: "/cart", label: "سبد خرید" },
    { href: "/reserve", label: "رزرو میز" },
  ];
  return (
    <>
      <button className="mobile-nav-toggle" type="button" aria-expanded={open} aria-controls="mobile-nav-panel" onClick={() => setOpen((value) => !value)}>
        <span /><span /><span />
        <b className="sr-only">{open ? "بستن منو" : "باز کردن منو"}</b>
      </button>
      <div className={`mobile-nav-panel${open ? " is-open" : ""}`} id="mobile-nav-panel" aria-hidden={!open}>
        {links.map((link) => (
          <a key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</a>
        ))}
      </div>
    </>
  );
}
