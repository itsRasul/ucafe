import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'" },
];
if (process.env.NODE_ENV === "production" && !String(process.env.PLATFORM_BASE_DOMAIN).endsWith(".localhost")) securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });

const nextConfig: NextConfig = { poweredByHeader: false, reactStrictMode: true, output: "standalone", async headers() { return [{ source: "/:path*", headers: securityHeaders }]; } };

export default nextConfig;
