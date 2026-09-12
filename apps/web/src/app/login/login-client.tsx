"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useClientSession } from "../client-session";
import { ClientAuthPanel } from "../client-auth-panel";

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
    <ClientAuthPanel session={session} cafeName={cafeName} logoUrl={logoUrl} />
  </div>;
}
