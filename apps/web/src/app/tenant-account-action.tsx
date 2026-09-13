"use client";

import { useClientSession } from "./client-session";
import { showClientSignedOutToast } from "./tenant-account-toast";

function LogoutIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>;
}

export function TenantAccountAction({ variant = "desktop", onNavigate }: { variant?: "desktop" | "mobile"; onNavigate?: () => void }) {
  const session = useClientSession();

  async function signOut() {
    await session.signOut();
    onNavigate?.();
    showClientSignedOutToast();
  }

  if (session.client) return <button type="button" className={variant === "desktop" ? "tenant-login-link tenant-nav-cta tenant-logout-button" : "mobile-nav-logout"} onClick={() => void signOut()}><LogoutIcon /><span>خروج</span></button>;

  return <a className={variant === "desktop" ? "tenant-login-link tenant-nav-cta" : undefined} href="/login" onClick={onNavigate}>ورود / ثبت‌نام</a>;
}
