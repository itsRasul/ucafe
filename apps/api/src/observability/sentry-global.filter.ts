import { Catch, HttpException } from "@nestjs/common";
import { SentryGlobalFilter } from "@sentry/nestjs/setup";
import * as Sentry from "@sentry/nestjs";

@Catch()
export class UcafeSentryGlobalFilter extends SentryGlobalFilter {
  override catch(exception: unknown, host: Parameters<SentryGlobalFilter["catch"]>[1]): void {
    if (exception instanceof HttpException && exception.getStatus() >= 500) {
      Sentry.captureException(exception, {
        mechanism: { handled: false, type: "auto.http.nestjs.global_filter" },
      });
    }
    super.catch(exception, host);
  }
}
