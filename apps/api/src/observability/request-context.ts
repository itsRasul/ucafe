import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nestjs";

export const observabilityFeatures = [
  "auth", "menu", "orders", "reservations", "payments", "subscriptions", "inventory", "analytics",
  "discounts", "platform_crm", "tenant_crm", "media", "notifications", "platform",
] as const;
export type ObservabilityFeature = (typeof observabilityFeatures)[number];

export const actorRoles = ["platform_admin", "tenant_owner", "tenant_staff", "client", "anonymous", "system"] as const;
export type ObservabilityActorRole = (typeof actorRoles)[number];

export type RequestObservabilityContext = {
  requestId: string;
  tenantId?: string;
  feature?: ObservabilityFeature;
  actorRole: ObservabilityActorRole;
};

const requestContexts = new AsyncLocalStorage<RequestObservabilityContext>();
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSafeRequestId(value: unknown): value is string {
  return typeof value === "string" && uuidV4.test(value);
}

export function canonicalRequestId(value?: string | null): string {
  return isSafeRequestId(value) ? value.toLowerCase() : randomUUID();
}

export function featureForPath(path: string): ObservabilityFeature | undefined {
  const parts = path.split(/[?#]/, 1)[0]!.split("/").filter(Boolean).map((part) => part.toLowerCase());
  if (parts[0] === "api" && parts[1] === "v1") parts.splice(0, 2);
  const [area, module] = parts;

  if (area === "auth" || module === "client-auth" || module === "admin") return "auth";
  if (area === "tenant") {
    if (module === "crm" || module === "customer-segments") return "tenant_crm";
    if (module === "menu") return "menu";
    if (module === "orders" || module === "ordering") return "orders";
    if (module === "reservations") return "reservations";
    if (module === "payments") return "payments";
    if (module === "subscription" || module === "plans") return "subscriptions";
    if (module === "inventory") return "inventory";
    if (module === "analytics") return "analytics";
    if (module === "promotions") return "discounts";
    if (module === "media") return "media";
    return "platform";
  }
  if (area === "platform") {
    if (module === "crm") return "platform_crm";
    if (module === "payments") return "payments";
    if (module === "media") return "media";
    if (module === "plans" || module === "subscriptions") return "subscriptions";
    if (module === "tenants") {
      if (parts.includes("subscription")) return "subscriptions";
      if (parts.includes("menu")) return "menu";
      if (parts.includes("media")) return "media";
    }
    return "platform";
  }
  if (area === "public") {
    if (module === "menu") return "menu";
    if (module === "ordering") return "orders";
    if (module === "reservations") return "reservations";
    if (module === "payments") return "payments";
    if (module === "client-panel" || module === "client-addresses") return "tenant_crm";
    if (module === "media") return "media";
    return "platform";
  }
  return undefined;
}

export function runWithRequestObservability<T>(requestId: string, feature: ObservabilityFeature | undefined, next: () => T): T {
  return Sentry.withIsolationScope(() => {
    const context: RequestObservabilityContext = { requestId, actorRole: "anonymous", ...(feature ? { feature } : {}) };
    const scope = Sentry.getIsolationScope();
    scope.setContext("request", { id: requestId });
    scope.setTag("actor_role", context.actorRole);
    if (feature) scope.setTag("feature", feature);
    return requestContexts.run(context, next);
  });
}

export function setTenantObservabilityContext(tenantId: string): void {
  const context = requestContexts.getStore();
  if (!context || !uuidV4.test(tenantId)) return;
  context.tenantId = tenantId.toLowerCase();
  Sentry.getIsolationScope().setTag("tenant_id", context.tenantId);
}

export function setActorObservabilityContext(actorRole: ObservabilityActorRole): void {
  const context = requestContexts.getStore();
  if (!context) return;
  context.actorRole = actorRole;
  Sentry.getIsolationScope().setTag("actor_role", actorRole);
}

export function getRequestObservabilityContext(): Readonly<RequestObservabilityContext> | undefined {
  return requestContexts.getStore();
}
