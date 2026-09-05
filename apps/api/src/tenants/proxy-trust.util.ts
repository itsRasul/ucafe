import { timingSafeEqual } from "node:crypto";

export function trustedForwardedTenantHost(headerValue: string | string[] | undefined, suppliedSecret: string | string[] | undefined, configuredSecret: string) {
  if (typeof headerValue !== "string" || typeof suppliedSecret !== "string") return undefined;
  const supplied = Buffer.from(suppliedSecret, "utf8");
  const configured = Buffer.from(configuredSecret, "utf8");
  if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) return undefined;
  return headerValue;
}
