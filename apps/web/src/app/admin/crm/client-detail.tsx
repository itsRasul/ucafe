"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { TenantPermission, useAdminSession } from "../admin-session";

type ClientDetailRecord = { id: string; firstName: string; lastName: string; phone: string; status: "ACTIVE" | "BLOCKED"; phoneVerifiedAt: string | null; createdAt: string; updatedAt: string };
const date = (value: string) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function ClientDetail() {
  const { clientId } = useParams<{ clientId: string }>();
  const { access, api } = useAdminSession();
  const [client, setClient] = useState<ClientDetailRecord>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const permitted = access.permissions.includes("tenant_crm.read" as TenantPermission);
  const entitled = access.features?.tenant_crm === true;
  useEffect(() => {
    if (!permitted || !entitled) { setLoading(false); return; }
    let active = true;
    api<ClientDetailRecord>(`/tenant/crm/clients/${encodeURIComponent(clientId)}`).then((value) => { if (active) setClient(value); })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, clientId, entitled, permitted]);

  if (!permitted) return <section className="tenant-crm-state"><h1>دسترسی محدود</h1><p>نقش شما اجازه مشاهده اطلاعات مشتری را ندارد.</p></section>;
  if (!entitled) return <section className="tenant-crm-state"><h1>CRM مشتریان</h1><p>مدیریت مشتریان در اشتراک فعلی فعال نیست.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;
  return <section className="tenant-crm">
    <Link href="/admin/crm" className="tenant-crm-back">بازگشت به فهرست مشتریان</Link>
    {loading ? <p className="tenant-crm-message" role="status">در حال دریافت اطلاعات مشتری…</p>
      : error ? <div className="tenant-crm-message" role="alert"><h1>اطلاعات مشتری در دسترس نیست</h1><p>{error}</p></div>
        : client ? <article className="tenant-crm-detail"><header className="tenant-crm-heading"><div><p className="eyebrow">جزئیات مشتری</p><h1>{client.firstName} {client.lastName}</h1></div><span className={`tenant-crm-status ${client.status === "ACTIVE" ? "is-active" : "is-blocked"}`}>{client.status === "ACTIVE" ? "فعال" : "مسدود"}</span></header>
          <dl><div><dt>شماره موبایل</dt><dd dir="ltr">{client.phone}</dd></div><div><dt>تأیید شماره</dt><dd>{client.phoneVerifiedAt ? `تأییدشده در ${date(client.phoneVerifiedAt)}` : "تأیید نشده"}</dd></div><div><dt>عضویت</dt><dd>{date(client.createdAt)}</dd></div><div><dt>آخرین به‌روزرسانی</dt><dd>{date(client.updatedAt)}</dd></div></dl>
        </article> : <p className="tenant-crm-message">مشتری پیدا نشد.</p>}
  </section>;
}
