import type { ErrorEvent } from "@sentry/nextjs";

const sensitiveAssignments = /\b(authorization|set-cookie|cookie|access[_-]?token|refresh[_-]?token|token|password|secret|otp|api[_-]?key|merchant[_-]?id|authority)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const phoneLikeNumber = /[+＋]?[0-9۰-۹٠-٩][0-9۰-۹٠-٩\s().-]{6,}[0-9۰-۹٠-٩]/g;
const emailAddress = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;

function sanitizeText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [Filtered]")
    .replace(sensitiveAssignments, "$1=[Filtered]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
    .replace(emailAddress, "[Email]")
    .replace(phoneLikeNumber, "[Phone]");
}

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  delete event.request;
  delete event.user;
  delete event.extra;
  delete event.tags;
  delete event.breadcrumbs;
  delete event.transaction;
  delete event.logentry;
  if (event.message) event.message = sanitizeText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = sanitizeText(exception.value);
  }
  return event;
}
