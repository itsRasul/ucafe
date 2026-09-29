import * as Sentry from "@sentry/nestjs";
import { getSentryOptions } from "./observability/sentry-options";

Sentry.init(getSentryOptions());
