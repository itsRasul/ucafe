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
  return <><button className="mobile-nav-toggle" type="button" aria-expanded={open} aria-controls="mobile-nav-panel" onClick={() => setOpen((value) => !value)}><span /><span /><span /><b className="sr-only">{open ? "بستن منو" : "باز کردن منو"}</b></button><div className={`mobile-nav-panel${open ? " is-open" : ""}`} id="mobile-nav-panel" aria-hidden={!open}><a href={`${sectionPrefix}#about`} onClick={() => setOpen(false)}>درباره ما</a><a href="/menu" onClick={() => setOpen(false)}>منو</a><a href={`${sectionPrefix}#gallery`} onClick={() => setOpen(false)}>گالری</a><a href={`${sectionPrefix}#visit`} onClick={() => setOpen(false)}>تماس و نشانی</a><a href="/reserve" onClick={() => setOpen(false)}>رزرو میز</a></div></>;
}
