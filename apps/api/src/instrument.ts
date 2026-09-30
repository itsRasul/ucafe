import * as Sentry from "@sentry/nestjs";
import { getSentryOptions } from "./observability/sentry-options";

const options = getSentryOptions();
Sentry.init({
  ...options,
  ...(options.tracesSampler ? { integrations: [Sentry.postgresIntegration()] } : {}),
});
