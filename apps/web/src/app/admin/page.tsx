"use client";

import Link from "next/link";
import { hasAnyPermission, TenantPermission, useAdminSession } from "./admin-session";

const modules: Array<{ title: string; detail: string; href: string; permissions: TenantPermission[]; future?: boolean }> = [
  { title: "وب‌سایت", detail: "محتوا، هویت بصری و ساعت کاری", href: "/admin/site", permissions: ["site.manage"] },
  { title: "منو", detail: "دسته‌بندی‌ها، آیتم‌ها و قیمت‌ها", href: "/admin/menu", permissions: ["menu.read", "menu.manage"] },
  { title: "رزروها", detail: "صف درخواست‌ها و تنظیمات پذیرش", href: "/admin/reservations", permissions: ["reservations.read", "reservations.manage"] },
  { title: "اشتراک", detail: "وضعیت طرح و دوره فعال", href: "/admin/subscription", permissions: ["subscription.read"] },
  { title: "امکانات طلایی", detail: "ابزارهای پیشرفته در نسخه‌های آینده", href: "#", permissions: [], future: true },
];

export default function AdminOverview() {
  const { access } = useAdminSession();
  return <section className="admin-overview"><header className="admin-page-heading"><div><p className="eyebrow">نمای کلی</p><h1>سلام، آماده‌ایم کافه را مرتب نگه داریم.</h1><p>از اینجا به بخش‌هایی که اجازه مدیریتشان را دارید دسترسی دارید.</p></div><span className={`tenant-state state-${access.tenant.status.toLowerCase()}`}>{access.tenant.status === "ACTIVE" ? "فعال" : access.tenant.status === "PREVIEW" ? "دوره آزمایشی" : "تعلیق"}</span></header><div className="admin-module-grid">{modules.map((module) => module.future ? <article className="admin-module-card locked" key={module.title}><span className="module-mark">＋</span><h2>{module.title}</h2><p>{module.detail}</p><small>نیازمند ارتقا · هنوز ارائه نشده</small></article> : hasAnyPermission(access.permissions, module.permissions) ? <Link className="admin-module-card" href={module.href} key={module.title}><span className="module-mark">←</span><h2>{module.title}</h2><p>{module.detail}</p><small>ورود به بخش</small></Link> : <article className="admin-module-card disabled" key={module.title}><span className="module-mark">—</span><h2>{module.title}</h2><p>{module.detail}</p><small>دسترسی برای نقش شما فعال نیست</small></article>)}</div></section>;
}
