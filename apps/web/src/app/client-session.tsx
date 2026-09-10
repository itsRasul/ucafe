"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { OtpCodeFields } from "./otp-code-fields";

type ApiError = { message?: string | string[] };
export type ClientIdentity = { id: string; firstName: string; lastName: string; phone: string };
type AuthResult = { accessToken: string; accessTokenExpiresInSeconds: number; client: ClientIdentity };

function storageKey() {
  return `ucafe_client_access:${location.host.toLowerCase()}`;
}

function messageFor(response: Response, body: ApiError) {
  const detail = Array.isArray(body.message) ? body.message[0] : body.message;
  if (response.status === 401) return "کد یا نشست شما معتبر نیست. دوباره تلاش کنید.";
  if (response.status === 403) return "این امکان برای این کافه فعال نیست.";
  if (response.status === 409) return "اطلاعات تغییر کرده است؛ صفحه را تازه کنید و دوباره تلاش کنید.";
  if (response.status === 429) return "درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.";
  return detail || "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.";
}

export async function clientRequest<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`/api/backend${path}`, { ...init, cache: "no-store", credentials: "same-origin", headers });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({})) as ApiError;
  if (!response.ok) throw Object.assign(new Error(messageFor(response, body)), { status: response.status, body });
  return body as T;
}

export function useClientSession() {
  const [token, setToken] = useState("");
  const [client, setClient] = useState<ClientIdentity | null>(null);
  const [state, setState] = useState<"loading" | "ready">("loading");

  const establish = useCallback(async (accessToken: string) => {
    const me = await clientRequest<ClientIdentity>("/public/client-auth/me", accessToken);
    sessionStorage.setItem(storageKey(), accessToken);
    setToken(accessToken);
    setClient(me);
    setState("ready");
    return me;
  }, []);

  const refresh = useCallback(async () => {
    const result = await clientRequest<AuthResult>("/public/client-auth/refresh", undefined, { method: "POST" });
    sessionStorage.setItem(storageKey(), result.accessToken);
    setToken(result.accessToken);
    setClient(result.client);
    setState("ready");
    return result.accessToken;
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey());
    (saved ? establish(saved).catch(refresh) : refresh())
      .catch(() => { sessionStorage.removeItem(storageKey()); setToken(""); setClient(null); setState("ready"); });
  }, [establish, refresh]);

  const api = useCallback(async <T,>(path: string, init?: RequestInit) => {
    try { return await clientRequest<T>(path, token, init); }
    catch (reason) {
      if ((reason as { status?: number }).status !== 401) throw reason;
      const nextToken = await refresh();
      return clientRequest<T>(path, nextToken, init);
    }
  }, [refresh, token]);

  async function requestOtp(phone: string) {
    return clientRequest<{ challengeId: string }>("/public/client-auth/otp/request", undefined, { method: "POST", body: JSON.stringify({ phone }) });
  }

  async function verifyOtp(input: { challengeId: string; otp: string; firstName?: string; lastName?: string }) {
    const result = await clientRequest<AuthResult>("/public/client-auth/otp/verify", undefined, { method: "POST", body: JSON.stringify(input) });
    sessionStorage.setItem(storageKey(), result.accessToken);
    setToken(result.accessToken);
    setClient(result.client);
    return result;
  }

  async function signOut() {
    try { await clientRequest("/public/client-auth/logout", undefined, { method: "POST" }); }
    finally { sessionStorage.removeItem(storageKey()); setToken(""); setClient(null); }
  }

  return { state, client, token, api, requestOtp, verifyOtp, signOut };
}

export type ClientSession = ReturnType<typeof useClientSession>;
type ClientAuthMode = "login" | "register";

export function ClientAuthForm({ session, title, registerTitle, detail = "برای ادامه، شماره موبایل خود را تأیید کنید.", onAuthenticated }: { session: ClientSession; title?: string; registerTitle?: string; detail?: string; onAuthenticated?: (client: ClientIdentity) => void }) {
  const [mode, setMode] = useState<ClientAuthMode>("login");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [otpDigits, setOtpDigits] = useState<string[]>(() => Array.from({ length: 6 }, () => ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submittingOtp = useRef(false);
  const otp = otpDigits.join("");

  async function submitPhone(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try { setChallengeId((await session.requestOtp(phone)).challengeId); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function verifyOtp(code: string) {
    if (code.length !== 6 || submittingOtp.current) return;
    submittingOtp.current = true; setBusy(true); setError("");
    try {
      const result = await session.verifyOtp({
        challengeId,
        otp: code,
        ...(mode === "register" ? { firstName: firstName.trim(), lastName: lastName.trim() } : {}),
      });
      onAuthenticated?.(result.client);
    } catch (reason) {
      if (mode === "login" && (reason as { status?: number }).status === 400) {
        setMode("register");
        setError("این شماره هنوز حساب مشتری ندارد؛ نام و نام خانوادگی را وارد و دوباره تأیید کنید.");
      } else setError((reason as Error).message);
    }
    finally { submittingOtp.current = false; setBusy(false); }
  }

  function submitOtp(event: FormEvent) { event.preventDefault(); void verifyOtp(otp); }
  function resetChallenge() { setChallengeId(""); setOtpDigits(Array.from({ length: 6 }, () => "")); setError(""); }
  function changeMode(nextMode: ClientAuthMode) { setMode(nextMode); resetChallenge(); }

  return <section className="client-auth-card" aria-labelledby="client-auth-title">
    <h1 id="client-auth-title">{challengeId ? "کد تأیید" : mode === "login" ? title ?? "ورود مشتری" : registerTitle ?? "ثبت‌نام مشتری"}</h1>
    <p>{challengeId ? `کد شش‌رقمی به ${phone} ارسال شد.` : detail}</p>
    {error && <p className="form-message error" role="alert">{error}</p>}
    {!challengeId ? <form onSubmit={submitPhone}>
      <div className="client-auth-switch" role="group" aria-label="انتخاب ورود یا ثبت‌نام">
        <button type="button" className={mode === "login" ? "is-active" : ""} aria-pressed={mode === "login"} onClick={() => changeMode("login")}>ورود</button>
        <button type="button" className={mode === "register" ? "is-active" : ""} aria-pressed={mode === "register"} onClick={() => changeMode("register")}>ثبت‌نام</button>
      </div>
      {mode === "register" && <div className="client-auth-grid">
        <label htmlFor="client-first-name">نام<input id="client-first-name" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={80} required /></label>
        <label htmlFor="client-last-name">نام خانوادگی<input id="client-last-name" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={80} required /></label>
      </div>}
      <label>شماره موبایل<input dir="ltr" inputMode="tel" autoComplete="tel" placeholder="09123456789" value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
      <button disabled={busy}>{busy ? "در حال ارسال…" : "دریافت کد تأیید"}</button>
    </form> : <form onSubmit={submitOtp}>
      {mode === "register" && (!firstName.trim() || !lastName.trim()) && <div className="client-auth-grid">
        <label htmlFor="client-otp-first-name">نام<input id="client-otp-first-name" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={80} required /></label>
        <label htmlFor="client-otp-last-name">نام خانوادگی<input id="client-otp-last-name" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={80} required /></label>
      </div>}
      <fieldset className="client-otp-fieldset">
        <legend>کد شش‌رقمی</legend>
        <OtpCodeFields value={otpDigits} onChange={setOtpDigits} onComplete={(code) => void verifyOtp(code)} disabled={busy} className="client-otp-inputs" />
      </fieldset>
      <button disabled={busy || otp.length !== 6}>{busy ? "در حال بررسی…" : "تأیید و ادامه"}</button>
      <button className="text-button full" type="button" onClick={resetChallenge} disabled={busy}>اصلاح شماره موبایل</button>
    </form>}
    <p className="client-auth-privacy">ورود شما با کد یک‌بارمصرف انجام می‌شود؛ رمز عبوری ذخیره نمی‌کنیم.</p>
  </section>;
}
