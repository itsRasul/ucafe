import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { request as httpRequest } from "node:http";
import type { CSSProperties } from "react";
import { ReserveFlow } from "./reserve-flow";

type TenantContext = { available: boolean };
type PublicSite = { name: string; theme: { primaryColor: string; primaryForeground: string; secondaryColor: string; secondaryForeground: string; accentColor: string; accentForeground: string } };
function load(apiBaseUrl: string, host: string, path: string): Promise<{ status: number; body: string }> { const url = new URL(`${apiBaseUrl}${path}`); return new Promise((resolve, reject) => { const request = httpRequest(url, { headers: { host } }, (response) => { const chunks: Buffer[] = []; response.on("data", (chunk: Buffer) => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode ?? 500, body: Buffer.concat(chunks).toString("utf8") })); }); request.on("error", reject); request.end(); }); }

export default async function ReservePage() {
  const host = (await headers()).get("host") ?? ""; const hostname = host.replace(/:\d+$/, "");
  const baseDomain = process.env.PLATFORM_BASE_DOMAIN ?? "cafexa.localhost"; if (!hostname.endsWith(`.${baseDomain}`)) notFound();
  const api = process.env.API_INTERNAL_URL ?? "http://localhost:3001/api/v1";
  const [contextResponse, siteResponse] = await Promise.all([load(api, host, "/public/context"), load(api, host, "/public/site")]);
  if (contextResponse.status !== 200 || siteResponse.status !== 200 || !(JSON.parse(contextResponse.body) as TenantContext).available) notFound();
  const site = JSON.parse(siteResponse.body) as PublicSite;
  const style = { "--tenant-primary": site.theme.primaryColor, "--tenant-on-primary": site.theme.primaryForeground, "--tenant-surface": site.theme.secondaryColor, "--tenant-on-surface": site.theme.secondaryForeground, "--tenant-accent": site.theme.accentColor, "--tenant-on-accent": site.theme.accentForeground } as CSSProperties;
  return <main className="reserve-page" style={style}><ReserveFlow cafeName={site.name} /></main>;
}
