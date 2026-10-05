"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export function SubscriptionRequiredDialog({ reason, onClose }: { reason: string | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (reason && !dialog.current?.open) dialog.current?.showModal();
    if (!reason) dialog.current?.close();
  }, [reason]);
  const trialExpired = reason === "TRIAL_EXPIRED";
  const expired = trialExpired || reason === "SUBSCRIPTION_EXPIRED" || reason === "SUBSCRIPTION_REQUIRED";
  return <dialog ref={dialog} className="subscription-required-dialog" aria-labelledby="subscription-required-title" aria-describedby="subscription-required-detail" onCancel={onClose} onClose={onClose}>
    <h2 id="subscription-required-title">{trialExpired ? "دوره آزمایشی به پایان رسیده است" : expired ? "اشتراک خود را فعال کنید" : "این قابلیت در پلن فعلی فعال نیست"}</h2>
    <p id="subscription-required-detail">{trialExpired ? "دوره آزمایشی یوکافه شما به پایان رسیده است. برای ادامه استفاده از امکانات، اشتراک خود را فعال کنید." : expired ? "اشتراک کافه شما فعال نیست. برای ادامه استفاده از امکانات، اشتراک خود را تمدید کنید." : "این قابلیت در اشتراک فعلی شما فعال نیست. برای استفاده از این بخش، پلن مناسب را انتخاب یا اشتراک خود را ارتقا دهید."}</p>
    <div className="subscription-required-actions"><Link href="/admin/subscription" onClick={onClose}>مشاهده پلن‌ها / تمدید اشتراک</Link><button type="button" onClick={onClose} autoFocus>بستن</button></div>
  </dialog>;
}
