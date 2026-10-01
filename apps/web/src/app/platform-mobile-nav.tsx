"use client";

import { useState } from "react";

export function PlatformMobileNav() {
  const [open, setOpen] = useState(false);
  return <div className={`platform-mobile-nav ${open ? "is-open" : ""}`} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); event.currentTarget.querySelector("button")?.focus(); } }}>
    <button type="button" aria-expanded={open} aria-controls="platform-mobile-links" onClick={() => setOpen((value) => !value)}>
      <span className="uc-sr-only">فهرست راهبری</span><i /><i />
    </button>
    <div id="platform-mobile-links" hidden={!open}>
      <a href="#features" onClick={() => setOpen(false)}>امکانات</a>
      <a href="#process" onClick={() => setOpen(false)}>روند همکاری</a>
      <a href="#pricing" onClick={() => setOpen(false)}>تعرفه</a>
      <a href="#faq" onClick={() => setOpen(false)}>سوالات متداول</a>
      <a href="/start" onClick={() => setOpen(false)}>ساخت کافه من</a>
      <a href="#request" onClick={() => setOpen(false)}>ثبت درخواست</a>
    </div>
  </div>;
}
