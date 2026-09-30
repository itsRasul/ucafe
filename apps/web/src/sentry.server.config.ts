import * as Sentry from "@sentry/nextjs";
import { getWebSentryOptions } from "./sentry-options";

const options = getWebSentryOptions(
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
  process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  process.env.SENTRY_TRACES_SAMPLE_RATE,
);
const apiUrl = new URL(process.env.API_INTERNAL_URL ?? "http://localhost:3001/api/v1");
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const apiTarget = new RegExp(`^${escapeRegex(apiUrl.origin)}${escapeRegex(apiUrl.pathname.replace(/\/$/, ""))}(?:/|$)`);

Sentry.init({ ...options, tracePropagationTargets: [apiTarget] });
