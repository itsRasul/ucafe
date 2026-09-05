import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const incomingHeaders = await headers();
  const url = new URL(`${process.env.API_INTERNAL_URL ?? "http://localhost:3001/api/v1"}/${path.join("/")}`);
  url.search = request.nextUrl.search;
  const authorization = incomingHeaders.get("authorization");
  const cookie = incomingHeaders.get("cookie");
  const response = await fetch(url, {
    method: request.method,
    headers: { "x-cafexa-tenant-host": incomingHeaders.get("host") ?? "", "x-cafexa-proxy-secret": process.env.INTERNAL_PROXY_SECRET ?? "", "content-type": incomingHeaders.get("content-type") ?? "application/json", ...(authorization ? { authorization } : {}), ...(cookie ? { cookie } : {}) },
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    cache: "no-store",
  });
  const outgoing = new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream" } });
  for (const header of ["cache-control", "content-length", "etag"]) {
    const value = response.headers.get(header); if (value) outgoing.headers.set(header, value);
  }
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) outgoing.headers.set("set-cookie", setCookie.replace(/Path=\/api\/v1\/auth/gi, "Path=/api/backend/auth"));
  return outgoing;
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
