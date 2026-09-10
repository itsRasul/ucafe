"use client";

import { useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ClientAuthForm, useClientSession } from "../client-session";
import { BrandLogo } from "../brand-logo";

export function LoginClient({ cafeName, logoUrl }: { cafeName: string; logoUrl?: string }) {
  const session = useClientSession();
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.from(".client-auth-visual img", { scale: 1.06, duration: 1.4, ease: "power3.out" });
    gsap.from(".client-auth-panel", { x: 24, duration: .65, ease: "power3.out", clearProps: "transform" });
  }, { scope: root });

  return <div className="client-auth-shell" ref={root}>
    <aside className="client-auth-visual" aria-label="فضای آرام یک کافه">
      <img src="/auth/ucafe-auth-cafe.jpg" alt="میز چوبی کافه با قهوه، کروسان و کتاب" />
      <div className="client-auth-visual-caption" aria-hidden="true"><span>ucafe</span><p>سفارش و رزرو، ساده و یک‌جا.</p></div>
    </aside>
    <section className="client-auth-panel" aria-label={`حساب مشتری ${cafeName}`}>
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
        : <ClientAuthForm session={session} title={`ورود به ${cafeName}`} registerTitle={`ثبت‌نام در ${cafeName}`} detail="برای رزرو میز یا ثبت سفارش، وارد شوید یا حساب مشتری بسازید." />}

      <div className="client-auth-powered"><BrandLogo variant="mark" /><span>ساخته‌شده با ucafe</span></div>
      <Link className="client-auth-back" href="/">بازگشت به سایت کافه <span aria-hidden="true">←</span></Link>
    </section>
  </div>;
}
