import type { ErrorEvent, Log } from "@sentry/nestjs";
import { actorRoles, isSafeRequestId, observabilityFeatures } from "./request-context";

const integrations = ["sms_ir", "zarinpal", "minio", "redis", "postgres"] as const;
const opaqueIdKeys = new Set(["request_id", "tenant_id", "workflow_id", "event_id", "order_id", "payment_id", "goods_receipt_id"]);
const sensitiveAssignments = /\b(authorization|set-cookie|cookie|access[_-]?token|refresh[_-]?token|token|jwt|password|passwd|secret|credential|otp|api[_-]?key|merchant[_-]?id|authority|database[_-]?url|redis[_-]?url|s3[_-]?(?:access[_-]?)?key|dsn)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const phoneLikeNumber = /[+＋]?[0-9۰-۹٠-٩][0-9۰-۹٠-٩\s().-]{6,}[0-9۰-۹٠-٩]/g;
const emailAddress = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;
const jwtLike = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const otpValue = /\b(?:otp|one[- ]time password)(?:\s+(?:code|value))?\s*[:=]?\s*\d{4,8}\b/gi;
const safeSpanDataKeys = new Set(["db.system", "db.operation", "db.operation.name", "http.request.method", "http.response.status_code", "http.status_code", "http.route"]);
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export function sanitizeText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [Filtered]")
    .replace(sensitiveAssignments, "$1=[Filtered]")
    .replace(otpValue, "OTP [Filtered]")
    .replace(jwtLike, "[JWT]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
    .replace(emailAddress, "[Email]")
    .replace(phoneLikeNumber, "[Phone]");
}

export function sanitizeStructuredAttributes(value: Record<string, unknown> = {}): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      if (opaqueIdKeys.has(key)) {
        if (isSafeRequestId(raw)) safe[key] = raw.toLowerCase();
      } else if (key === "feature" && observabilityFeatures.includes(raw as (typeof observabilityFeatures)[number])) {
        safe[key] = raw;
      } else if (key === "actor_role" && actorRoles.includes(raw as (typeof actorRoles)[number])) {
        safe[key] = raw;
      } else if (key === "integration" && integrations.includes(raw as (typeof integrations)[number])) {
        safe[key] = raw;
      } else if (key === "job_name" && /^[a-z0-9_.-]{1,64}$/.test(raw)) {
        safe[key] = raw;
      } else if (key === "error_code" && /^[A-Z][A-Z0-9_.-]{0,79}$/.test(raw)) {
        safe[key] = raw;
      }
    } else if (typeof raw === "number" && ((key === "attempt" && Number.isInteger(raw) && raw >= 0 && raw <= 100) ||
      (key === "status_code" && Number.isInteger(raw) && raw >= 100 && raw <= 599))) {
      safe[key] = raw;
    }
  }
  return safe;
}

function safeContexts(contexts: ErrorEvent["contexts"]): ErrorEvent["contexts"] {
  const safe: NonNullable<ErrorEvent["contexts"]> = {};
  const requestId = (contexts?.request as { id?: unknown } | undefined)?.id;
  if (isSafeRequestId(requestId)) safe.request = { id: requestId.toLowerCase() };
  const rawTrace = contexts?.trace as { trace_id?: unknown; span_id?: unknown; parent_span_id?: unknown } | undefined;
  const traceId = typeof rawTrace?.trace_id === "string" && /^[0-9a-f]{32}$/i.test(rawTrace.trace_id) ? rawTrace.trace_id.toLowerCase() : undefined;
  const spanId = typeof rawTrace?.span_id === "string" && /^[0-9a-f]{16}$/i.test(rawTrace.span_id) ? rawTrace.span_id.toLowerCase() : undefined;
  const parentSpanId = typeof rawTrace?.parent_span_id === "string" && /^[0-9a-f]{16}$/i.test(rawTrace.parent_span_id) ? rawTrace.parent_span_id.toLowerCase() : undefined;
  if (traceId && spanId) safe.trace = { trace_id: traceId, span_id: spanId, ...(parentSpanId ? { parent_span_id: parentSpanId } : {}) };
  return Object.keys(safe).length ? safe : undefined;
}

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  delete event.request;
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  delete event.transaction;
  delete event.logentry;

  const tags = sanitizeStructuredAttributes(event.tags);
  const safeTags = Object.fromEntries(Object.entries(tags).filter(([key]) =>
    key === "tenant_id" || key === "feature" || key === "actor_role" || key === "integration"));
  event.tags = Object.keys(safeTags).length ? safeTags : undefined;
  event.contexts = safeContexts(event.contexts);

  if (event.message) event.message = sanitizeText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = sanitizeText(exception.value);
  }
  return event;
}

export function sanitizeSentryLog(log: Log): Log | null {
  if (typeof log.message !== "string") return null;
  return {
    ...log,
    message: sanitizeText(log.message),
    attributes: sanitizeStructuredAttributes(log.attributes),
  };
}

function sanitizeSpanDescription(value: string): string {
  return sanitizeText(value.replace(uuid, ":id").replace(/\/\d{3,}(?=\/|$|[?\s])/g, "/:id")).replace(/\?.*?(?=\s|$)/g, "");
}

type SpanLike = { data?: Record<string, unknown>; description?: string; op?: string; links?: unknown };

export function sanitizeSentrySpan<T extends SpanLike>(span: T): T {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(span.data ?? {})) {
    if (!safeSpanDataKeys.has(key)) continue;
    if ((key === "http.response.status_code" || key === "http.status_code") && typeof value === "number" && value >= 100 && value <= 599) data[key] = value;
    else if (typeof value === "string") {
      if (key === "http.route") data[key] = sanitizeSpanDescription(value);
      else if (key === "db.system" && ["postgres", "postgresql", "redis"].includes(value.toLowerCase())) data[key] = value.toLowerCase();
      else if ((key === "db.operation" || key === "db.operation.name") && /^[a-z]{1,20}$/i.test(value)) data[key] = value.toLowerCase();
      else if (key === "http.request.method" && /^[a-z]{3,10}$/i.test(value)) data[key] = value.toUpperCase();
    }
  }
  span.data = data;
  const database = data["db.system"];
  if (database === "postgres" || database === "postgresql" || database === "redis" || /^db(?:[._-]|$)/i.test(span.op ?? "")) {
    const operation = data["db.operation.name"] ?? data["db.operation"];
    span.description = `${database === "redis" ? "redis" : "postgresql"} ${typeof operation === "string" ? operation : "operation"}`;
  } else if (span.description) {
    span.description = sanitizeSpanDescription(span.description);
  }
  delete span.links;
  return span;
}

type TransactionLike = {
  request?: unknown;
  user?: unknown;
  extra?: unknown;
  breadcrumbs?: unknown;
  tags?: Record<string, unknown>;
  contexts?: ErrorEvent["contexts"];
  transaction?: string;
  spans?: SpanLike[];
};

export function sanitizeSentryTransaction<T extends TransactionLike>(event: T): T {
  delete event.request;
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  const tags = sanitizeStructuredAttributes(event.tags);
  const safeTags = Object.fromEntries(Object.entries(tags).filter(([key]) =>
    key === "tenant_id" || key === "feature" || key === "actor_role" || key === "integration"));
  event.tags = Object.keys(safeTags).length ? safeTags : undefined;
  event.contexts = safeContexts(event.contexts) as T["contexts"];
  if (event.transaction) event.transaction = sanitizeSpanDescription(event.transaction);
  if (event.spans) event.spans = event.spans.map(sanitizeSentrySpan) as T["spans"];
  return event;
}
