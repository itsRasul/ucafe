"use client";

import { ClipboardEvent, FormEvent, KeyboardEvent, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";

export type TenantPermission = "site.manage" | "menu.read" | "menu.manage" | "reservations.read" | "reservations.manage" | "staff.manage" | "subscription.read" | "subscription.checkout";
type Access = { tenant: { slug: string; status: string; locale: string; timezone: string }; permissions: TenantPermission[] };
type ApiError = { message?: string | string[] };
type SessionContext = { access: Access; api: <T>(path: string, init?: RequestInit) => Promise<T>; signOut: () => Promise<void> };

const AdminSessionContext = createContext<SessionContext | null>(null);
const accessKey = "cafexa_owner_access";

function messageFor(response: Response, body: ApiError) {
  const detail = Array.isArray(body.message) ? body.message[0] : body.message;
  if (response.status === 403) return "این حساب اجازه دسترسی به این بخش از کافه را ندارد.";
  if (response.status === 409) return "این عملیات دیگر مجاز نیست؛ اطلاعات را تازه کنید.";
  return detail || "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.";
}

async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`/api/backend${path}`, { ...init, cache: "no-store", credentials: "same-origin", headers });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({})) as ApiError;
  if (!response.ok) throw Object.assign(new Error(messageFor(response, body)), { status: response.status });
  return body as T;
}

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState("");
  const [access, setAccess] = useState<Access | null>(null);
  const [state, setState] = useState<"loading" | "login" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const establish = useCallback(async (accessToken: string) => {
    const result = await request<Access>("/tenant/admin/access", accessToken);
    sessionStorage.setItem(accessKey, accessToken);
    setToken(accessToken); setAccess(result); setState("ready"); setError("");
  }, []);

  const refresh = useCallback(async () => {
    const result = await request<{ accessToken: string }>("/auth/refresh", undefined, { method: "POST" });
    await establish(result.accessToken);
    return result.accessToken;
  }, [establish]);

  useEffect(() => {
    const saved = sessionStorage.getItem(accessKey);
    (saved ? establish(saved).catch(refresh) : refresh())
      .catch((reason: Error & { status?: number }) => { sessionStorage.removeItem(accessKey); setState(reason.status === 403 ? "error" : "login"); setError(reason.status === 403 ? reason.message : ""); });
  }, [establish, refresh]);

  const api = useCallback(async <T,>(path: string, init?: RequestInit) => {
    try { return await request<T>(path, token, init); }
    catch (reason) {
      if ((reason as { status?: number }).status !== 401) throw reason;
      try { return await request<T>(path, await refresh(), init); }
      catch (refreshError) { sessionStorage.removeItem(accessKey); setToken(""); setAccess(null); setState("login"); throw refreshError; }
    }
  }, [refresh, token]);

  async function signOut() {
    try { await request("/auth/logout", undefined, { method: "POST" }); } finally { sessionStorage.removeItem(accessKey); setToken(""); setAccess(null); setState("login"); }
  }

  if (state === "loading") return <AdminState title="در حال آماده‌سازی پنل…" detail="نشست امن شما بررسی می‌شود." busy />;
  if (state === "error") return <AdminState title="دسترسی مدیریت فعال نیست" detail={error} />;
  if (state === "login" || !access) return <AdminLogin onAuthenticated={establish} />;
  return <AdminSessionContext.Provider value={{ access, api, signOut }}>{children}</AdminSessionContext.Provider>;
}

function AdminLogin({ onAuthenticated }: { onAuthenticated: (token: string) => Promise<void> }) {
  const [phone, setPhone] = useState(""); const [challengeId, setChallengeId] = useState(""); const [otpDigits, setOtpDigits] = useState<string[]>(() => Array.from({ length: 6 }, () => "")); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const otp = otpDigits.join("");
  const submittingOtp = useRef(false);

  async function submitPhone(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { setChallengeId((await request<{ challengeId: string }>("/auth/otp/request", undefined, { method: "POST", body: JSON.stringify({ phone }) })).challengeId); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function verifyOtp(code: string) {
    if (code.length !== 6 || submittingOtp.current) return;
    submittingOtp.current = true; setBusy(true); setError("");
    try {
      const result = await request<{ accessToken: string }>("/auth/otp/verify", undefined, { method: "POST", body: JSON.stringify({ challengeId, otp: code }) });
      await onAuthenticated(result.accessToken);
    } catch (reason) { setError((reason as Error).message); }
    finally { submittingOtp.current = false; setBusy(false); }
  }

  function submitOtp(event: FormEvent) { event.preventDefault(); void verifyOtp(otp); }
  function editPhone() { setChallengeId(""); setOtpDigits(Array.from({ length: 6 }, () => "")); setError(""); }

  return <main className="admin-entry auth-entry">
    <aside className="auth-visual" aria-label="فضای آرام یک کافه">
      <img src="/auth/cafexa-auth-cafe.jpg" alt="میز چوبی کافه با قهوه، کروسان و کتاب" />
      <div className="auth-visual-caption" aria-hidden="true"><span>CAFEXA</span><p>مدیریت کافه، ساده و یک‌جا.</p></div>
    </aside>
    <section className="admin-login auth-card" aria-labelledby="admin-login-title">
      <div className="auth-brand" aria-label="کافکسا">
        <span className="auth-brand-mark" aria-hidden="true" />
        <strong dir="ltr">Cafexa</strong>
      </div>

      <div className="auth-copy">
        <p className="eyebrow">پنل مدیریت کافه</p>
        <h1 id="admin-login-title">{challengeId ? "کد تأیید" : "ورود به کافکسا"}</h1>
        <p>{challengeId ? <>کد شش‌رقمی ارسال‌شده به <bdi dir="ltr">{phone}</bdi> را وارد کنید.</> : "برای دسترسی به بخش‌های مجاز، شماره ثبت‌شده کافه را وارد کنید."}</p>
      </div>

      {error && <p className="admin-message error" role="alert">{error}</p>}

      {!challengeId ? <form onSubmit={submitPhone}>
        <label htmlFor="admin-phone">شماره موبایل</label>
        <div className="auth-input-shell">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M8.2 3.5 9.7 7a1.5 1.5 0 0 1-.4 1.7L7.7 10a13.2 13.2 0 0 0 6.3 6.3l1.3-1.6a1.5 1.5 0 0 1 1.7-.4l3.5 1.5a1.5 1.5 0 0 1 .9 1.6l-.4 2.8a1.5 1.5 0 0 1-1.5 1.3C10.1 21.5 2.5 13.9 2.5 4.5A1.5 1.5 0 0 1 3.8 3l2.8-.4a1.5 1.5 0 0 1 1.6.9Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <input id="admin-phone" dir="ltr" inputMode="tel" autoComplete="tel" placeholder="09123456789" value={phone} onChange={(event) => setPhone(event.target.value)} required autoFocus />
        </div>
        <button className="auth-primary-button" disabled={busy}>{busy ? "در حال ارسال…" : "دریافت کد ورود"}</button>
      </form> : <form onSubmit={submitOtp}>
        <fieldset className="auth-otp-fieldset">
          <legend>کد شش‌رقمی</legend>
          <OtpCodeFields value={otpDigits} onChange={setOtpDigits} onComplete={(code) => void verifyOtp(code)} disabled={busy} />
        </fieldset>
        <button className="auth-primary-button" disabled={busy || otp.length !== 6}>{busy ? "در حال بررسی…" : "ورود به پنل"}</button>
        <button type="button" className="admin-link-button" onClick={editPhone} disabled={busy}>اصلاح شماره موبایل</button>
      </form>}

      <p className="auth-privacy">ورود شما با کد یک‌بارمصرف انجام می‌شود؛ رمز عبوری ذخیره نمی‌کنیم.</p>
      <Link className="auth-back-link" href="/">بازگشت به سایت کافه <span aria-hidden="true">←</span></Link>
    </section>
  </main>;
}

function OtpCodeFields({ value, onChange, onComplete, disabled }: { value: string[]; onChange: (value: string[]) => void; onComplete: (value: string) => void; disabled: boolean }) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value;

  function applyDigits(startIndex: number, rawValue: string) {
    const incoming = rawValue.replace(/\D/g, "");
    if (!incoming) return;
    const next = [...digits];
    incoming.slice(0, 6 - startIndex).split("").forEach((digit, offset) => { next[startIndex + offset] = digit; });
    const code = next.join(""); onChange(next);
    const nextEmpty = next.findIndex((digit, index) => index >= startIndex && !digit);
    inputRefs.current[nextEmpty === -1 ? 5 : nextEmpty]?.focus();
    if (next.every(Boolean)) onComplete(code);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) inputRefs.current[index - 1]?.focus();
    if (event.key === "ArrowLeft" && index > 0) inputRefs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < 5) inputRefs.current[index + 1]?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    event.preventDefault(); applyDigits(0, pasted);
  }

  return <div className="auth-otp-inputs" dir="ltr" onPaste={handlePaste}>
    {digits.map((digit, index) => <input
      key={index}
      ref={(element) => { inputRefs.current[index] = element; }}
      type="text"
      inputMode="numeric"
      autoComplete={index === 0 ? "one-time-code" : "off"}
      pattern="[0-9]"
      maxLength={1}
      value={digit}
      aria-label={`رقم ${index + 1} از ۶`}
      disabled={disabled}
      autoFocus={index === 0}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => handleKeyDown(index, event)}
      onChange={(event) => {
        const rawValue = event.target.value;
        if (rawValue.replace(/\D/g, "").length > 1) { applyDigits(index, rawValue); return; }
        const next = [...digits]; next[index] = rawValue.replace(/\D/g, "").slice(-1);
        const code = next.join(""); onChange(next);
        if (next[index] && index < 5) inputRefs.current[index + 1]?.focus();
        if (next.every(Boolean)) onComplete(code);
      }}
    />)}
  </div>;
}

function AdminState({ title, detail, busy = false }: { title: string; detail: string; busy?: boolean }) { return <main className="admin-entry"><section className="admin-state" aria-live="polite">{busy && <span className="admin-spinner" aria-hidden="true" />}<h1>{title}</h1><p>{detail}</p></section></main>; }
export function useAdminSession() { const value = useContext(AdminSessionContext); if (!value) throw new Error("Admin session is unavailable"); return value; }
export function hasAnyPermission(permissions: TenantPermission[], required: TenantPermission[]) { return required.some((permission) => permissions.includes(permission)); }
