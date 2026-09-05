import { cache } from "react";
import { headers } from "next/headers";
import { request as httpRequest } from "node:http";
import type { PublicMenu, PublicSite, TenantContext } from "./tenant-public";

type PlatformPublicData = { isTenant: false };
type MissingTenantData = { isTenant: true; context: null; site: null; menu: null };
type TenantPublicData = {
  isTenant: true;
  context: TenantContext;
  site: PublicSite | null;
  menu: PublicMenu | null;
};

export type PublicPageData = PlatformPublicData | MissingTenantData | TenantPublicData;

export type PublicOffering = {
  key: string;
  name: string;
  priceToman: string;
  billingMonths: number;
  trialDays: number;
};

function loadApiPath(apiBaseUrl: string, host: string, path: string): Promise<{ status: number; body: string }> {
  const url = new URL(`${apiBaseUrl}${path}`);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: "GET", headers: { host } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 500, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

export const loadPublicPageData = cache(async (): Promise<PublicPageData> => {
  const host = (await headers()).get("host")?.toLowerCase() ?? "";
  const hostname = host.replace(/:\d+$/, "").replace(/\.$/, "");
  const baseDomain = process.env.PLATFORM_BASE_DOMAIN ?? "u-cafe.localhost";
  if (!hostname.endsWith(`.${baseDomain}`)) return { isTenant: false };

  const apiBaseUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001/api/v1";
  const contextResponse = await loadApiPath(apiBaseUrl, host, "/public/context");
  if (contextResponse.status === 404) return { isTenant: true, context: null, site: null, menu: null };
  if (contextResponse.status < 200 || contextResponse.status >= 300) throw new Error("Tenant context is temporarily unavailable");

  const context = JSON.parse(contextResponse.body) as TenantContext;
  if (!context.available) return { isTenant: true, context, site: null, menu: null };

  const [siteResponse, menuResponse] = await Promise.all([
    loadApiPath(apiBaseUrl, host, "/public/site"),
    loadApiPath(apiBaseUrl, host, "/public/menu"),
  ]);
  if (siteResponse.status < 200 || siteResponse.status >= 300) throw new Error("Tenant site content is temporarily unavailable");
  if (menuResponse.status < 200 || menuResponse.status >= 300) throw new Error("Tenant menu is temporarily unavailable");

  return {
    isTenant: true,
    context,
    site: JSON.parse(siteResponse.body) as PublicSite,
    menu: JSON.parse(menuResponse.body) as PublicMenu,
  };
});

export const loadPlatformOffering = cache(async (): Promise<PublicOffering | null> => {
  const apiBaseUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001/api/v1";
  try {
    const response = await loadApiPath(apiBaseUrl, "", "/public/platform/offering");
    if (response.status < 200 || response.status >= 300) return null;
    return JSON.parse(response.body) as PublicOffering;
  } catch {
    return null;
  }
});
