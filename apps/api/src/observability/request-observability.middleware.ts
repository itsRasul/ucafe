import { Logger } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

const logger = new Logger("HttpRequest");
const requestIdPattern = /^[A-Za-z0-9_-]{8,80}$/;

export function requestObservability(request: Request, response: Response, next: NextFunction) {
  const supplied = request.get("x-request-id");
  const requestId = supplied && requestIdPattern.test(supplied) ? supplied : randomUUID();
  const startedAt = process.hrtime.bigint();
  response.setHeader("x-request-id", requestId);
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  response.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.log(JSON.stringify({ event: "http_request", requestId, method: request.method, path: request.path, statusCode: response.statusCode, durationMs: Number(durationMs.toFixed(1)) }));
  });
  next();
}
