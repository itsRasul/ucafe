import * as Sentry from "@sentry/nextjs";
import { getWebSentryOptions } from "./sentry-options";

Sentry.init(getWebSentryOptions(
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
  process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE,
));
