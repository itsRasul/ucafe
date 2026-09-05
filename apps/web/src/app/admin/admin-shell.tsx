"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasAnyPermission, TenantPermission, useAdminSession } from "./admin-session";

const items: Array<{ href: string; label: string; short: string; permissions: TenantPermission[] }> = [
  { href: "/admin", label: "نمای کلی", short: "خانه", permissions: ["site.manage", "menu.read", "reservations.read", "subscription.read"] },
  { href: "/admin/site", label: "وب‌سایت", short: "سایت", permissions: ["site.manage"] },
  { href: "/admin/menu", label: "منو", short: "منو", permissions: ["menu.read", "menu.manage"] },
  { href: "/admin/reservations", label: "رزروها", short: "رزرو", permissions: ["reservations.read", "reservations.manage"] },
  { href: "/admin/subscription", label: "اشتراک", short: "اشتراک", permissions: ["subscription.read"] },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const { access, signOut } = useAdminSession();
  const visible = items.filter((item) => hasAnyPermission(access.permissions, item.permissions));
  return <main className="admin-app"><aside className="admin-sidebar"><Link className="admin-brand" href="/admin"><span>ک</span><div><strong>کافکسا</strong><small>مدیریت کافه</small></div></Link><nav aria-label="ناوبری مدیریت">{visible.map((item) => <Link key={item.href} href={item.href} className={pathname === item.href ? "active" : ""}><span>{item.label}</span></Link>)}</nav><div className="admin-sidebar-foot"><small>{access.tenant.slug}</small><button onClick={signOut}>خروج امن</button></div></aside><div className="admin-main"><header className="admin-mobile-header"><Link className="admin-brand" href="/admin"><span>ک</span><strong>کافکسا</strong></Link><button onClick={signOut}>خروج</button></header><div className="admin-content">{children}</div><nav className="admin-bottom-nav" aria-label="ناوبری موبایل">{visible.map((item) => <Link key={item.href} href={item.href} className={pathname === item.href ? "active" : ""}>{item.short}</Link>)}</nav></div></main>;
}
