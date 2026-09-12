"use client";

import Link from "next/link";
import { BrandLogo } from "./brand-logo";
import { ClientAuthForm, type ClientIdentity, type ClientSession } from "./client-session";

export function ClientAuthPanel({ session, cafeName, logoUrl, onAuthenticated, showBackLink = true }: { session: ClientSession; cafeName: string; logoUrl?: string; onAuthenticated?: (client: ClientIdentity) => void; showBackLink?: boolean }) {
  return <section className="client-auth-panel" aria-label={`حساب مشتری ${cafeName}`}>
    <div className="client-auth-brand">
      {logoUrl ? <img src={logoUrl} alt={`نشان ${cafeName}`} /> : <span className="client-cafe-mark" aria-hidden="true">{cafeName.trim().charAt(0)}</span>}
      <strong>{cafeName}</strong>
    </div>
    {session.state === "loading" ? <div className="admin-inline-loading" aria-live="polite"><span className="admin-spinner" />در حال بررسی نشست…</div>
      : session.client ? <section className="client-auth-card client-auth-success" aria-labelledby="client-auth-success-title">
        <h1 id="client-auth-success-title">خوش آمدید</h1>
        <p>{session.client.firstName} {session.client.lastName}، با شماره <bdi dir="ltr">{session.client.phone.replace(/^\+98/, "0")}</bdi> وارد شده‌اید.</p>
        <div className="client-auth-success-actions"><Link href="/menu">مشاهده منو</Link><Link href="/reserve">رزرو میز</Link></div>
        <button className="text-button full" type="button" onClick={session.signOut}>خروج از حساب</button>
      </section>
      : <ClientAuthForm session={session} title={`ورود به ${cafeName}`} registerTitle={`ثبت‌نام در ${cafeName}`} detail="برای رزرو میز یا ثبت سفارش، وارد شوید یا حساب مشتری بسازید." onAuthenticated={onAuthenticated} />}
    <div className="client-auth-powered"><BrandLogo variant="mark" /><span>ساخته‌شده با ucafe</span></div>
    {showBackLink && <Link className="client-auth-back" href="/">بازگشت به سایت کافه <span aria-hidden="true">←</span></Link>}
  </section>;
}
