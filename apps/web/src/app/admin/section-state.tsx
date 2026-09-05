"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TenantPermission, useAdminSession } from "./admin-session";
export function AdminSectionState({ title, permission, endpoint, describe }: { title: string; permission: TenantPermission; endpoint: string; describe: (value: unknown) => React.ReactNode }) {
  const { access, api } = useAdminSession(); const [value, setValue] = useState<unknown>(); const [error, setError] = useState(""); const permitted = access.permissions.includes(permission);
  useEffect(() => { if (permitted) api(endpoint).then(setValue).catch((reason: Error) => setError(reason.message)); }, [api, endpoint, permitted]);
  if (!permitted) return <section className="admin-section-state"><p className="eyebrow">دسترسی محدود</p><h1>{title}</h1><p>نقش شما اجازه مشاهده این بخش را ندارد.</p><Link href="/admin">بازگشت به نمای کلی</Link></section>;
  if (error) return <section className="admin-section-state error-state"><p className="eyebrow">خطا در بارگذاری</p><h1>{title}</h1><p role="alert">{error}</p><button onClick={() => location.reload()}>تلاش دوباره</button></section>;
  if (value === undefined) return <section className="admin-section-state loading-state" aria-live="polite"><span className="admin-spinner" /><h1>در حال بارگذاری {title}…</h1></section>;
  return <section className="admin-readonly-section"><header><div><p className="eyebrow">مدیریت کافه</p><h1>{title}</h1></div><span>نمای خلاصه</span></header>{describe(value)}<div className="admin-coming-soon"><strong>ویرایش این بخش در مرحله بعد فعال می‌شود.</strong><p>در این مرحله فقط پوسته، دسترسی و وضعیت فعلی نمایش داده می‌شود.</p></div></section>;
}
