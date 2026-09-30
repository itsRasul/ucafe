import { cache } from "react";
import { headers } from "next/headers";
import { request as httpRequest } from "node:http";
import { canonicalRequestId } from "../request-id";
import type { PublicMenu, PublicOrderingState, PublicSite, TenantContext } from "./tenant-public";

type PlatformPublicData = { isTenant: false };
type MissingTenantData = { isTenant: true; context: null; site: null; menu: null; ordering: null };
type TenantPublicData = {
  isTenant: true;
  context: TenantContext;
  site: PublicSite | null;
  menu: PublicMenu | null;
  ordering: PublicOrderingState | null;
};

export type PublicPageData = PlatformPublicData | MissingTenantData | TenantPublicData;

export type PublicOffering = {
  key: string;
  name: string;
  priceToman: string;
  billingMonths: number;
  trialDays: number;
};

function loadApiPath(apiBaseUrl: string, host: string, path: string, requestId: string): Promise<{ status: number; body: string }> {
  const url = new URL(`${apiBaseUrl}${path}`);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: "GET", headers: { host, "x-request-id": requestId } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 500, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

export const loadPublicPageData = cache(async (): Promise<PublicPageData> => {
  const incomingHeaders = await headers();
  const host = incomingHeaders.get("host")?.toLowerCase() ?? "";
  const requestId = canonicalRequestId(incomingHeaders.get("x-request-id"));
  const hostname = host.replace(/:\d+$/, "").replace(/\.$/, "");
  const baseDomain = process.env.PLATFORM_BASE_DOMAIN ?? "u-cafe.localhost";
  if (!hostname.endsWith(`.${baseDomain}`)) return { isTenant: false };

  const apiBaseUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001/api/v1";
  const contextResponse = await loadApiPath(apiBaseUrl, host, "/public/context", requestId);
  if (contextResponse.status === 404) return { isTenant: true, context: null, site: null, menu: null, ordering: null };
  if (contextResponse.status < 200 || contextResponse.status >= 300) throw new Error("Tenant context is temporarily unavailable");

  const context = JSON.parse(contextResponse.body) as TenantContext;
  if (!context.available) return { isTenant: true, context, site: null, menu: null, ordering: null };

  const [siteResponse, menuResponse, orderingResponse] = await Promise.all([
    loadApiPath(apiBaseUrl, host, "/public/site", requestId),
    loadApiPath(apiBaseUrl, host, "/public/menu", requestId),
    loadApiPath(apiBaseUrl, host, "/public/ordering/settings", requestId),
  ]);
  if (siteResponse.status < 200 || siteResponse.status >= 300) throw new Error("Tenant site content is temporarily unavailable");
  if (menuResponse.status < 200 || menuResponse.status >= 300) throw new Error("Tenant menu is temporarily unavailable");

  return {
    isTenant: true,
    context,
    site: JSON.parse(siteResponse.body) as PublicSite,
    menu: JSON.parse(menuResponse.body) as PublicMenu,
    ordering: orderingResponse.status >= 200 && orderingResponse.status < 300 ? JSON.parse(orderingResponse.body) as PublicOrderingState : null,
  };
});

export const loadPlatformOffering = cache(async (): Promise<PublicOffering | null> => {
  const apiBaseUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001/api/v1";
  try {
    const requestId = canonicalRequestId((await headers()).get("x-request-id"));
    const response = await loadApiPath(apiBaseUrl, "", "/public/platform/offering", requestId);
    if (response.status < 200 || response.status >= 300) return null;
    return JSON.parse(response.body) as PublicOffering;
  } catch {
    return null;
  }
});
