import { sanitizeSentryEvent } from "./sentry-privacy";

export function getSentryOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    dsn: env.NODE_ENV === "test" ? undefined : env.SENTRY_DSN || undefined,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || "development",
    release: env.SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
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
  };
}
