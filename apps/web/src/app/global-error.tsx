"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    if (!error.digest) Sentry.captureException(error);
  }, [error]);

  return <html lang="fa" dir="rtl"><body><main><h1>مشکلی پیش آمد</h1><p>لطفاً دوباره تلاش کنید.</p><button onClick={retry}>تلاش دوباره</button></main></body></html>;
}
