import * as Sentry from "@sentry/nextjs";
import { getWebSentryOptions } from "./sentry-options";

const options = getWebSentryOptions(
  process.env.NEXT_PUBLIC_SENTRY_DSN,
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
  process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
);
Sentry.init({
  ...options,
  tracePropagationTargets: [/^\/api\/backend(?:\/|$)/],
  ...(options.tracesSampler ? { integrations: [Sentry.browserTracingIntegration()] } : {}),
});
