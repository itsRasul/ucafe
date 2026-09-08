"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandLogo } from "../brand-logo";
import { hasAnyPermission, TenantPermission, useAdminSession } from "./admin-session";

const items: Array<{ href: string; label: string; short: string; icon: string; permissions: TenantPermission[] }> = [
  { href: "/admin", label: "نمای کلی", short: "خانه", icon: "dashboard", permissions: ["site.manage", "menu.read", "reservations.read", "subscription.read"] },
  { href: "/admin/site", label: "وب‌سایت", short: "سایت", icon: "site", permissions: ["site.manage"] },
  { href: "/admin/menu", label: "منو", short: "منو", icon: "menu", permissions: ["menu.read", "menu.manage"] },
  { href: "/admin/reservations", label: "رزروها", short: "رزرو", icon: "reservations", permissions: ["reservations.read", "reservations.manage"] },
  { href: "/admin/subscription", label: "اشتراک", short: "اشتراک", icon: "subscription", permissions: ["subscription.read"] },
  { href: "/admin/invoices", label: "فاکتورها", short: "فاکتور", icon: "subscription", permissions: ["subscription.read"] },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const { access, api, signOut } = useAdminSession();
  const [subscriptionWarning, setSubscriptionWarning] = useState(false);
  useEffect(() => {
    if (!access.permissions.includes("subscription.read")) return;
    api<{ isRenewalWarning: boolean; status: string }>("/tenant/subscription").then((result) => setSubscriptionWarning(result.isRenewalWarning || result.status === "GRACE" || result.status === "SUSPENDED")).catch(() => undefined);
  }, [access.permissions, api]);
  const visible = items.filter((item) => hasAnyPermission(access.permissions, item.permissions));
  const current = visible.find((item) => item.href === "/admin" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)) ?? visible[0];
  const isActive = (href: string) => href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const warningDot = (href: string) => subscriptionWarning && href === "/admin/subscription";
  return <main className="admin-app"><div className="admin-frame"><aside className="admin-sidebar"><div><Link className="admin-brand" href="/admin"><BrandLogo className="admin-brand-logo" variant="mark" /><div><strong>یو کافه</strong><small>پنل مالک کافه</small></div></Link><nav aria-label="ناوبری مدیریت">{visible.map((item) => <Link key={item.href} href={item.href} className={isActive(item.href) ? "active" : ""}><i className={`nav-icon nav-icon-${item.icon}`} aria-hidden="true" /><span>{item.label}</span>{warningDot(item.href) && <b aria-label="هشدار تمدید" />}</Link>)}</nav></div><div className="admin-sidebar-foot"><div><strong>{access.tenant.slug}</strong><small>{access.tenant.status === "ACTIVE" ? "کافه فعال" : access.tenant.status === "PREVIEW" ? "دوره آزمایشی" : "نیازمند پیگیری"}</small></div><button onClick={signOut}>خروج امن</button></div></aside><div className="admin-main"><header className="admin-topbar"><div><i className={`nav-icon nav-icon-${current?.icon ?? "dashboard"}`} aria-hidden="true" /><strong>{current?.label ?? "مدیریت"}</strong></div><label className="admin-search"><span>جست‌وجو</span><input aria-label="جست‌وجوی نمایشی پنل" placeholder="جست‌وجو..." disabled /></label><button onClick={signOut}>خروج</button></header><header className="admin-mobile-header"><Link className="admin-brand" href="/admin"><BrandLogo className="admin-brand-logo" variant="mark" /><strong>یو کافه</strong></Link><button onClick={signOut}>خروج</button></header><div className="admin-content">{children}</div><nav className="admin-bottom-nav" aria-label="ناوبری موبایل">{visible.map((item) => <Link key={item.href} href={item.href} className={isActive(item.href) ? "active" : ""}><i className={`nav-icon nav-icon-${item.icon}`} aria-hidden="true" /><span>{item.short}</span>{warningDot(item.href) && <b aria-label="هشدار تمدید" />}</Link>)}</nav></div></div></main>;
}
