"use client";

import { FormEvent, useRef, useState } from "react";
import { Button } from "./ui/primitives";

const services = [
  ["WEBSITE", "وب‌سایت کافه"],
  ["ONLINE_MENU", "منوی آنلاین"],
  ["RESERVATIONS", "رزرو میز"],
  ["CONTENT_MANAGEMENT", "مدیریت محتوا"],
  ["CONSULTATION", "مشاوره"],
] as const;

type SubmitState = "idle" | "sending" | "success" | "error";

export function PlatformOrderForm() {
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || state === "success") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      contactName: data.get("contactName"), coffeeShopName: data.get("coffeeShopName"), phone: data.get("phone"), city: data.get("city"),
      businessStage: data.get("businessStage"), requestedServices: data.getAll("requestedServices"), note: data.get("note"), website: data.get("website"),
    };
    if (payload.requestedServices.length === 0) { setState("error"); setMessage("حداقل یک خدمت را انتخاب کنید."); return; }
    submitting.current = true; setState("sending"); setMessage("");
    try {
      const response = await fetch("/api/backend/public/platform/order-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) {
        if (response.status === 429) throw new Error("درخواست شما به‌تازگی ثبت شده است. لطفاً کمی بعد دوباره تلاش کنید.");
        throw new Error("ثبت درخواست انجام نشد. اطلاعات را بررسی و دوباره تلاش کنید.");
      }
      form.reset(); setState("success"); setMessage("درخواست شما ثبت شد. تیم یو کافه در اولین فرصت با شما تماس می‌گیرد.");
    } catch (error) {
      setState("error"); setMessage(error instanceof Error ? error.message : "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
    } finally { submitting.current = false; }
  }

  return <form className="platform-form" onSubmit={submit} aria-busy={state === "sending"}>
    <div className="form-grid">
      <label><span>نام و نام خانوادگی</span><input name="contactName" autoComplete="name" maxLength={100} required /></label>
      <label><span>نام کافه</span><input name="coffeeShopName" autoComplete="organization" maxLength={160} required /></label>
      <label><span>شماره موبایل</span><input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="۰۹۱۲۱۲۳۴۵۶۷" minLength={10} maxLength={20} required dir="ltr" /></label>
      <label><span>شهر</span><input name="city" autoComplete="address-level2" maxLength={100} required /></label>
      <label className="form-wide"><span>کافه شما در چه مرحله‌ای است؟</span><select name="businessStage" defaultValue="" required><option value="" disabled>انتخاب کنید</option><option value="LAUNCHING">در حال راه‌اندازی</option><option value="OPERATING">فعال</option><option value="MULTI_BRANCH">چند شعبه‌ای</option></select></label>
    </div>
    <fieldset aria-describedby={state === "error" ? "consultation-message" : undefined}><legend>چه خدماتی نیاز دارید؟</legend><div className="service-checks">{services.map(([value, label]) => <label key={value}><input type="checkbox" name="requestedServices" value={value} /><span>{label}</span></label>)}</div></fieldset>
    <label className="note-field"><span>توضیحات بیشتر <small>اختیاری</small></span><textarea name="note" maxLength={1000} rows={4} placeholder="از کافه، زمان شروع یا نیازهای خاص‌تان بگویید." /></label>
    <label className="form-honeypot" aria-hidden="true">وب‌سایت<input name="website" tabIndex={-1} autoComplete="off" /></label>
    <div className="form-submit"><Button type="submit" disabled={state === "sending" || state === "success"}>{state === "sending" ? "در حال ثبت…" : state === "success" ? "درخواست ثبت شد" : "ثبت درخواست مشاوره"}</Button><p>ارسال این فرم به معنی پرداخت یا شروع اشتراک نیست.</p></div>
    {message && <p id="consultation-message" className={`form-message ${state}`} role={state === "error" ? "alert" : "status"}>{message}</p>}
  </form>;
}
