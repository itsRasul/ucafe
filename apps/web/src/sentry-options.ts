import { sanitizeSentryEvent, sanitizeSentrySpan, sanitizeSentryTransaction } from "./sentry-privacy";

export function getTraceSampleRate(environment: string, configured?: string): number {
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
  location?: { href?: string };
  normalizedRequest?: { url?: string };
  inheritOrSampleWith: (fallback: number) => number;
};

export function getWebSentryOptions(dsn: string | undefined, environment: string, release?: string, configuredSampleRate?: string) {
  const activeDsn = process.env.NODE_ENV === "test" ? undefined : dsn || undefined;
  const sampleRate = getTraceSampleRate(process.env.NODE_ENV === "test" ? "test" : environment, configuredSampleRate);
  return {
    dsn: activeDsn,
    environment,
    release: release || undefined,
    sendDefaultPii: false,
    enableLogs: false,
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
    beforeSendSpan: sanitizeSentrySpan,
    beforeSendTransaction: sanitizeSentryTransaction,
    tracesSampler: activeDsn && sampleRate > 0 ? (context: TraceSamplingContext) =>
      [context.location?.href, context.normalizedRequest?.url, context.name].some(isExcludedTracePath) ? 0 : context.inheritOrSampleWith(sampleRate) : undefined,
  };
}
