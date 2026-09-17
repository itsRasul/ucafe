"use client";

import Link from "next/link";
import { useClientSession } from "./client-session";

function AccountIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" /></svg>;
}

export function TenantAccountAction({ variant = "desktop", onNavigate }: { variant?: "desktop" | "mobile"; onNavigate?: () => void }) {
  const session = useClientSession();

  if (session.state === "loading") return <span className="tenant-account-loading" aria-hidden="true" />;
  if (session.client) return <Link aria-label="پنل مشتری" title="پنل مشتری" className={variant === "desktop" ? "tenant-login-link tenant-nav-cta tenant-account-link" : "mobile-nav-account"} href="/panel" onClick={onNavigate}><AccountIcon /><span>{variant === "mobile" ? "پنل من" : "پنل"}</span></Link>;

  return <Link className={variant === "desktop" ? "tenant-login-link tenant-nav-cta" : undefined} href="/login" onClick={onNavigate}>ورود / ثبت‌نام</Link>;
}
