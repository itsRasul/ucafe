"use client";

import { useState } from "react";

export function PlatformMobileNav() {
  const [open, setOpen] = useState(false);
  return <div className={`platform-mobile-nav ${open ? "is-open" : ""}`}>
    <button type="button" aria-expanded={open} aria-controls="platform-mobile-links" onClick={() => setOpen((value) => !value)}>
      <span className="sr-only">فهرست راهبری</span><i /><i />
    </button>
    <div id="platform-mobile-links" hidden={!open}>
      <a href="#services" onClick={() => setOpen(false)}>خدمات</a>
      <a href="#process" onClick={() => setOpen(false)}>روند همکاری</a>
      <a href="#pricing" onClick={() => setOpen(false)}>تعرفه</a>
      <a href="#request" onClick={() => setOpen(false)}>ثبت درخواست</a>
    </div>
  </div>;
}
