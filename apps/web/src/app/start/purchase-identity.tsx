"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { OtpCodeFields } from "../otp-code-fields";
import { Button } from "../ui/primitives";
import { purchaseApi } from "./purchase-api";

export function PurchaseIdentity({ onAuthenticated }: { onAuthenticated: (token: string) => Promise<void> }) {
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [state, setState] = useState<"restoring" | "ready" | "busy">("restoring");
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const sending = useRef(false);
  const onReady = useRef(onAuthenticated);
  const restoration = useRef<Promise<string> | null>(null);
  onReady.current = onAuthenticated;

  useEffect(() => {
    let canceled = false;
    async function restore() {
      const token = sessionStorage.getItem("ucafe_owner_access") ?? "";
      if (token) {
        try { await purchaseApi("/auth/me", token); return token; } catch { /* Renew through the existing HttpOnly cookie. */ }
      }
      return (await purchaseApi<{ accessToken: string }>("/auth/refresh", undefined, {})).accessToken;
    }
    restoration.current ??= restore();
    void restoration.current.then(async (token) => { if (!canceled) { sessionStorage.setItem("ucafe_owner_access", token); await onReady.current(token); } }).catch(() => { if (!canceled) { sessionStorage.removeItem("ucafe_owner_access"); setState("ready"); } });
    return () => { canceled = true; };
  }, []);
  useEffect(() => { if (cooldown <= 0) return; const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000); return () => clearTimeout(timer); }, [cooldown]);

  async function requestCode(event?: FormEvent) {
    event?.preventDefault(); if (sending.current) return;
    sending.current = true; setState("busy"); setError("");
    try { const result = await purchaseApi<{ challengeId: string; resendAfterSeconds: number }>("/auth/otp/request", undefined, { phone }); setChallenge(result.challengeId); setCooldown(result.resendAfterSeconds); setDigits(Array(6).fill("")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "ارسال کد انجام نشد."); }
    finally { sending.current = false; setState("ready"); }
  }
  async function verify(code: string) {
    if (code.length !== 6 || sending.current) return;
    sending.current = true; setState("busy"); setError("");
    try { const result = await purchaseApi<{ accessToken: string }>("/auth/otp/verify", undefined, { challengeId: challenge, otp: code }); sessionStorage.setItem("ucafe_owner_access", result.accessToken); await onReady.current(result.accessToken); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "تأیید شماره انجام نشد."); }
    finally { sending.current = false; setState("ready"); }
  }
  if (state === "restoring") return <p role="status">در حال بررسی نشست امن شما…</p>;
  return <div className="uc-purchase-identity"><h2>{challenge ? "کد تأیید را وارد کن." : "با شماره خودت شروع کن."}</h2><p>{challenge ? <>کد شش‌رقمی برای <bdi dir="ltr">{phone}</bdi> ارسال شد.</> : "این شماره، حساب مدیر کافه‌ات خواهد بود. ورود با کد یک‌بارمصرف انجام می‌شود."}</p>
    {error && <p id="purchase-identity-error" role="alert" className="uc-alert uc-alert--error">{error}</p>}
    {!challenge ? <form onSubmit={requestCode}><label htmlFor="purchase-phone">شماره موبایل</label><input id="purchase-phone" type="tel" dir="ltr" autoComplete="tel" inputMode="tel" maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} required disabled={state === "busy"} aria-describedby={error ? "purchase-identity-error" : undefined} /><Button disabled={state === "busy"}>{state === "busy" ? "در حال ارسال…" : "دریافت کد تأیید"}</Button></form> : <form onSubmit={(event) => { event.preventDefault(); void verify(digits.join("")); }}><fieldset><legend>کد شش‌رقمی</legend><OtpCodeFields value={digits} onChange={setDigits} onComplete={(code) => void verify(code)} disabled={state === "busy"} className="uc-purchase-otp" /></fieldset><Button disabled={state === "busy" || digits.join("").length !== 6}>{state === "busy" ? "در حال بررسی…" : "تأیید و ادامه"}</Button><div className="uc-actions"><Button variant="ghost" type="button" disabled={state === "busy"} onClick={() => { setChallenge(""); setError(""); }}>اصلاح شماره</Button><Button variant="ghost" type="button" disabled={state === "busy" || cooldown > 0} onClick={() => void requestCode()}>{cooldown > 0 ? `ارسال دوباره تا ${new Intl.NumberFormat("fa-IR").format(cooldown)} ثانیه` : "ارسال دوباره کد"}</Button></div></form>}
  </div>;
}
