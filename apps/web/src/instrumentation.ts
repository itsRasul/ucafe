import * as Sentry from "@sentry/nextjs";
import { canonicalRequestId } from "./request-id";
import { featureForWebPath } from "./sentry-privacy";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

export function onRequestError(
  error: unknown,
  request: Parameters<typeof Sentry.captureRequestError>[1],
  errorContext: Parameters<typeof Sentry.captureRequestError>[2],
) {
  const requestHeader = request.headers["x-request-id"];
  const requestId = canonicalRequestId(typeof requestHeader === "string" ? requestHeader : undefined);
  return Sentry.withIsolationScope(() => {
    const scope = Sentry.getIsolationScope();
    scope.setContext("request", { id: requestId });
    const feature = featureForWebPath(errorContext.routePath);
    if (feature) scope.setTag("feature", feature);
    Sentry.captureRequestError(error, request, errorContext);
  });
}
