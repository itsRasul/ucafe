import { sanitizeSentryEvent, sanitizeSentryLog, sanitizeSentrySpan, sanitizeSentryTransaction } from "./sentry-privacy";

export function getTraceSampleRate(environment: string | undefined, configured?: string): number {
  if (environment === "test") return 0;
  if (configured?.trim()) {
    const rate = Number(configured);
    return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0;
  }
  return environment === "production" ? 0.05 : environment === "development" ? 1 : 0;
}

export function isExcludedTracePath(value: string | undefined): boolean {
  if (!value) return false;
  const path = value.replace(/^\w+\s+/, "").replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/, 1)[0]!.toLowerCase();
  return path === "/health" || path === "/api/v1/health" || path === "/api/v1/health/ready" || path === "/favicon.ico" ||
    path === "/monitoring" || path.startsWith("/monitoring/") || path.startsWith("/_next/");
}

type TraceSamplingContext = {
  name: string;
  normalizedRequest?: { url?: string };
  inheritOrSampleWith: (fallback: number) => number;
};

export function getSentryOptions(env: NodeJS.ProcessEnv = process.env) {
  const dsn = env.NODE_ENV === "test" ? undefined : env.SENTRY_DSN || undefined;
  const sampleRate = getTraceSampleRate(env.NODE_ENV, env.SENTRY_TRACES_SAMPLE_RATE);
  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || "development",
    release: env.SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    enableLogs: true,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    beforeBreadcrumb: () => null,
    beforeSend: sanitizeSentryEvent,
    beforeSendLog: sanitizeSentryLog,
    beforeSendSpan: sanitizeSentrySpan,
    beforeSendTransaction: sanitizeSentryTransaction,
    tracePropagationTargets: [],
    tracesSampler: dsn && sampleRate > 0 ? (context: TraceSamplingContext) =>
      [context.normalizedRequest?.url, context.name].some(isExcludedTracePath) ? 0 : context.inheritOrSampleWith(sampleRate) : undefined,
  };
}
