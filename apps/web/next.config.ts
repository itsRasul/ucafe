import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const isDevelopment = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "connect-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
];

if (
  process.env.NODE_ENV === "production" &&
  process.env.PLATFORM_BASE_DOMAIN &&
  !process.env.PLATFORM_BASE_DOMAIN.endsWith(".localhost")
) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  });
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: "standalone",

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

const hasSentryAuthToken = Boolean(process.env.SENTRY_AUTH_TOKEN);
const sentryNextConfig = withSentryConfig(nextConfig, {
  org: "ucafe",
  project: "ucafe-web",
  tunnelRoute: "/monitoring",
  suppressOnRouterTransitionStartWarning: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: {
    disable: !hasSentryAuthToken,
    filesToDeleteAfterUpload: ["**/*.map"],
  },
});

// Phase 1 is error-only; this SDK-added experiment propagates tracing headers for pageload tracing.
if (sentryNextConfig.experimental) delete sentryNextConfig.experimental.clientTraceMetadata;

export default sentryNextConfig;
