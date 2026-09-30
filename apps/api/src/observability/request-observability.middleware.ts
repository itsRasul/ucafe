import { Logger } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { canonicalRequestId, featureForPath, runWithRequestObservability } from "./request-context";

const logger = new Logger("HttpRequest");

export function requestObservability(request: Request, response: Response, next: NextFunction) {
  const requestId = canonicalRequestId(request.get("x-request-id"));
  const feature = featureForPath(request.path);
  const startedAt = process.hrtime.bigint();
  return runWithRequestObservability(requestId, feature, () => {
    response.setHeader("x-request-id", requestId);
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
    response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.log(JSON.stringify({
        level: "info",
        message: "HTTP request completed",
        request_id: requestId,
        ...(feature ? { feature } : {}),
        method: request.method,
        status_code: response.statusCode,
        duration_ms: Number(durationMs.toFixed(1)),
      }));
    });
    next();
  });
}
