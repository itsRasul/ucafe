import { sanitizeSentryEvent } from "./sentry-privacy";

export function getWebSentryOptions(dsn: string | undefined, environment: string, release?: string) {
  return {
    dsn: process.env.NODE_ENV === "test" ? undefined : dsn || undefined,
    environment,
    release: release || undefined,
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
