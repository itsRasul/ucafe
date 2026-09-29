# Observability and Sentry

## Scope

This document records the Phase 0 audit, the implemented Phase 1 error-monitoring boundary, and later-phase decisions. Phase 1 enables only error capture; it does not enable tracing, replay, log forwarding, profiling, alerts, or monitors.

## Verified from code

### Runtime and deployment

- The npm-workspace monorepo contains `@ucafe/api`, `@ucafe/web`, and `@ucafe/worker`. The worker is an empty Nest application context and is not connected to database work. Current timers run in API services. See [architecture](ARCHITECTURE.md).
- Docker builds API and web separately from the same checkout. API builds with `nest build`; its production command runs TypeORM migrations and then `node apps/api/dist/main.js`. Web uses Next.js 16 App Router, `next build --webpack`, standalone output, and `node apps/web/server.js`.
- `compose.dev.yaml` sets `NODE_ENV=development`; `compose.prod.yaml` sets `NODE_ENV=production`. API config permits `development`, `test`, and `production`. There is no staging compose configuration or tracked CI/deployment pipeline. Production hosting, TLS proxy, and secret management are external to this repository.
- Workspace versions are `0.1.0`. API and web accept separate DSNs, optional explicit environments, and an optional shared release. API TypeScript emits source maps into `dist`; the web build uploads source maps only when its build secret is present and deletes uploaded maps. Without that secret, Sentry source-map handling is disabled. No tracked release value or deployment pipeline injects a release.
- Both SDKs are pinned to stable `10.75.3`. This release supports the repository's Node 22 image, NestJS 11, and Next.js 16; the SDK remains below the new major so Phase 1 does not inherit new-major behavior. See the [Sentry JavaScript 10.75.3 release](https://github.com/getsentry/sentry-javascript/releases/tag/10.75.3), [Nest SDK](https://github.com/getsentry/sentry-javascript/tree/10.75.3/packages/nestjs), and [Next SDK](https://github.com/getsentry/sentry-javascript/tree/10.75.3/packages/nextjs).
- Compose uses the `node:22-bookworm-slim` API/web images and the repository's development workflow is the documented Compose overlay. During Phase 1 validation, PostgreSQL, Redis, MinIO, API, and web were running; API readiness and the web homepage returned HTTP 200.

### API error handling

- [API bootstrap](../apps/api/src/main.ts) creates Nest with its default logger and Express adapter, installs `requestObservability`, cookie parsing, a global transforming/whitelisting `ValidationPipe`, the `/api/v1` prefix, and shutdown hooks.
- Phase 1 registers the official `SentryGlobalFilter` through a narrow subclass. It captures unknown failures and HTTP exceptions with status 500+, while Sentry's filter skips expected HTTP exceptions and retains Nest's `BaseExceptionFilter` response. No UCafe process-level `uncaughtException` / `unhandledRejection` handlers were added. Tenant context is separate middleware registered by `TenantsModule` for `public/*` and `tenant/*` routes.
- Most scheduled loops catch their own failures; the notification timer calls `void dispatch()` without a top-level catch. An unexpected poll-level rejection therefore reaches Node's default unhandled-rejection behavior. Per-message SMS failures are caught and persisted separately.
- Nest's default `BaseExceptionFilter` sends ordinary `HttpException` responses and logs unknown exceptions. UCafe has no single response envelope or exception-normalization layer; some feature/suspension errors intentionally use stable `code` fields. Unknown failures return Nest's generic 500 response.
- The SDK filter delegates response formatting to Nest's `BaseExceptionFilter`. Its default expected-error check skips all `HttpException` values, so the subclass captures only the missing unexpected 5xx case before delegating; each path is captured once.

### Web error handling

- [Web app](../apps/web/src/app) is Next.js 16 App Router with server-rendered pages/components, client components, and the same-origin `/api/backend/[...path]` route handler. Phase 1 adds client/server instrumentation, `error.tsx`, and `global-error.tsx`.
- API helper functions throw on non-2xx responses; individual screens catch errors and render local messages. Phase 1 adds Next client/server instrumentation plus app and root error boundaries. Server-rendered tenant data throws on required API failures, while platform-offering loading fails closed to `null`.
- The proxy forwards the request body, query, authorization, and cookie to the API. It forwards selected response headers and rewrites refresh-cookie paths, but currently neither forwards `x-request-id` nor returns the API's `x-request-id` to the caller.

### Logging

- Runtime code uses Nest `Logger` directly in the request middleware and selected services. There is no custom logger provider, Winston/Pino dependency, normalized structured metadata API, JSON transport, file sink, or Sentry log forwarding. In Docker, Nest stdout/stderr is the available container log stream. Runtime errors use `@sentry/nestjs` and `@sentry/nextjs`; the installed Sentry coding-agent plugin is separate from those SDKs.
- The request middleware emits a JSON string containing `event`, `requestId`, method, raw pathname, status, and duration. The pathname excludes the query string but can contain resource IDs. Some inventory events are JSON strings; most other service/job messages are plain text. No handler directly formats an HTTP body, authorization header, cookie, provider response body, or full phone in its log call.
- Notification and CRM job logs use event/type/status or opaque entity IDs. Two inventory error paths include an exception stack. CLI `console.log` usage is limited to tenant provisioning and platform-owner bootstrap output; provisioning prints its result, while bootstrap prints an opaque user ID and role key. These are operator command outputs, not request telemetry, and must not be forwarded to Sentry. Database audit rows and domain outboxes are business records, not general telemetry.
- **Privacy finding:** [development SMS](../apps/api/src/auth/development-sms.provider.ts) logs the plaintext OTP and a masked phone. Its constructor rejects `NODE_ENV=production`, and the API schema also requires the real SMS provider in production. This is a development-only credential exposure: development logs must never be forwarded to the production Sentry environment. No production-path OTP logging was found.

### Request and tenant context

- [Request observability middleware](../apps/api/src/observability/request-observability.middleware.ts) accepts an incoming `x-request-id` only when it matches `[A-Za-z0-9_-]{8,80}`; otherwise it generates a UUID. It returns that value in the response header and logs it when the response finishes, but does not attach it to the request object or async work. A valid ID is caller-supplied today, so it is a correlation hint, not a trusted identity or trace.
- **Privacy finding:** the accepted request-ID pattern also permits a digit-only phone-shaped value. A caller can therefore cause a phone number to be logged as `requestId`, even though no logger directly formats phone fields. Phase 1 deliberately does not attach request IDs to Sentry; safe request correlation remains Phase 2 work.
- The Next proxy drops the ID in both directions. Server-side tenant page loading uses Node HTTP directly and sends the external `Host`, not a request ID. No W3C trace context or shared request context is present.
- `TenantContextMiddleware` resolves the normalized host through an active `domains` row and attaches an opaque `coffeeShopId`, slug, status, locale, timezone, hostname, and domain type to that Express request. It runs only for public and tenant route families. It does not trust an arbitrary tenant ID from a public DTO. Platform requests have no implicit tenant context; tenant-targeted platform actions identify their target explicitly.
- Administrative authentication adds only `userId` and `sessionId` to a request. A successful tenant permission guard adds `membershipId` and `coffeeShopId`; platform permission checks do not attach a role object. Client authentication adds `clientId`, `sessionId`, and the host-matched `coffeeShopId`. The client JWT must match the resolved host. Roles and permissions are database-backed, not trusted token claims. No request-scoped tenant/actor singleton or AsyncLocalStorage implementation exists.
- CRM and Tenant CRM workflows persist their own `correlation_id` values to join durable business events and actions. Those IDs are not HTTP request IDs and must not be conflated with them.

### Jobs and integrations

Current API timers are per API process; `@ucafe/worker` does not run these jobs.

| Job | Current behavior | Operational category |
| --- | --- | --- |
| Notification outbox dispatcher and schedule scan | Every 5 seconds; schedules are swept at most once per minute. SMS deliveries retry up to 3 times, then persist `FAILED`; an unexpected poll-level rejection is not caught by the timer callback. | Important: customer/owner notices and reminders can be delayed or exhausted. |
| Tenant CRM loyalty outbox | Every 5 seconds; processes delivered-order events, with up to 5 attempts and a durable failed state. | Important: customer points can be delayed; core order/payment commits do not wait on it. |
| Tenant CRM automations | Every 5 seconds; durable events/actions retry and become terminal after bounded attempts; time triggers scan once per minute. | Important for enabled CRM workflows, not core checkout or payment. |
| Platform CRM workflow runtime | Every 5 seconds, scans scheduled triggers at most once per minute, retries/reclaims durable work, and marks terminal failures. | Important for platform sales/admin workflow execution. |
| Inventory batch expiry alerts | Timer checks every minute but refreshes once per Tehran calendar date; failed sweeps retry on a later tick. | Important operational alerting; it does not perform stock movement or order/payment commits. |
| Platform CRM lead-score refresh | Startup refresh plus daily refresh; derived scores can be recomputed. | Non-critical. |

No current timer is the authority for payment, order, reservation-capacity, or subscription-entitlement commits; those paths execute synchronously/transactionally. Thus there is no current critical background timer. Do not create a Sentry Cron monitor for every polling tick; later monitor durable backlog age, exhausted work, and meaningful scheduled runs.

- SMS.ir uses a 10-second request timeout and maps provider failures to a generic service error. Direct OTP delivery has no application retry; notification outbox delivery has bounded retries.
- Zarinpal request/verify calls use a 10-second timeout and generic gateway errors; payment requests are not blindly retried. Do not attach merchant credentials, authority values, callback query strings, or gateway payloads to telemetry.
- Media uses AWS SDK S3 client against private MinIO/S3-compatible storage. No UCafe-specific timeout/retry policy is configured; startup bucket checks fail startup when storage cannot be prepared. No email provider or general external API client was found.
- The observed dev stack has Redis readiness checks, but Redis is not an application cache or rate limiter today.

### Environments, release, and existing privacy controls

- The configured deployment environments are `development` and `production`; API also permits `test`. Staging is not configured and API rejects it. `SENTRY_ENVIRONMENT` can override the SDK environment when it is one of the API's allowed values; otherwise it falls back to `NODE_ENV`.
- No release value is currently configured by Compose or tracked CI. Compose passes `SENTRY_RELEASE` through when supplied and also passes it to the web build as `NEXT_PUBLIC_SENTRY_RELEASE`.
- [API Sentry config](../apps/api/src/observability/sentry-options.ts) disables capture without `SENTRY_DSN`; web uses `NEXT_PUBLIC_SENTRY_DSN` in the browser and `SENTRY_DSN` at runtime. Compose passes the web public DSN/environment/release at both build time and runtime so development and production clients can initialize. Automated API tests use a fake in-memory transport, never a real DSN.

| Variable | Service and phase | Classification | Behavior |
| --- | --- | --- | --- |
| `SENTRY_DSN` | API runtime; web runtime | Optional runtime configuration | Separate project DSN for the API. Compose maps the public web DSN to web runtime `SENTRY_DSN`. Blank/unset disables that client. |
| `NEXT_PUBLIC_SENTRY_DSN` | Web build and runtime/browser | Optional, public/browser-safe configuration | Web project DSN compiled into production browser instrumentation and passed to the development client; not an auth credential. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Web build and runtime/browser | Optional, public/browser-safe configuration | Set by Compose from `SENTRY_ENVIRONMENT` so browser events use the same environment as the web server. |
| `SENTRY_ENVIRONMENT` | API/web runtime | Optional runtime configuration | Explicit SDK environment; unset falls back to `NODE_ENV`. Use only `development`, `test`, or `production` in the API. |
| `SENTRY_RELEASE` | API/web runtime and web build | Optional runtime/build configuration | External deployment release value; provide the Git SHA when available. |
| `NEXT_PUBLIC_SENTRY_RELEASE` | Web build and runtime/browser | Optional, public/browser-safe configuration | Set by Compose from `SENTRY_RELEASE` so browser events use the same release. |
| `SENTRY_AUTH_TOKEN` | Web image build only | Optional build-time secret | BuildKit secret for source-map upload. It is not a build arg or runtime environment variable and is not copied into the final image. |
- Authentication/session rules keep OTPs out of persistence, hash access/session tokens, encrypt stored phone/outbox data, and use HttpOnly refresh cookies. These controls do not automatically sanitize error events. Tenant CRM notes, preferences/custom fields, feedback, customer identity, order/reservation data, payment authority/reference values, uploaded media, and provider credentials must be treated as sensitive even when an exception occurs near them.

## Phase 0 decisions and later-phase boundaries

### Explicitly deferred

- **Phase 2:** tenant and actor context, safe request correlation across Next/API, and structured Sentry logs.
- **Phase 3:** tracing/performance, alerts, uptime, profiling, custom metrics, cron monitoring, and advanced dashboards.
- **Not enabled in this phase:** Session Replay, Seer, log forwarding, database/Redis tracing, and user feedback.

### Project architecture

Use the `ucafe` organization with exactly two application projects:

- `ucafe-api`: Nest HTTP failures, selected API/integration failures, and terminal background-job failures.
- `ucafe-web`: Next server-rendered, route-handler, and unhandled client application failures. Do not recapture ordinary API error responses already reported by `ucafe-api`.

The web build is configured for organization `ucafe` and project `ucafe-web`; API project selection is determined by its separately supplied `SENTRY_DSN`. In development validation, the configured API and web DSNs each accepted a synthetic event with HTTP 200, and a web event sent through `/monitoring` was also accepted with HTTP 200. This verifies delivery to the configured DSNs, but no authenticated Sentry integration was available to look up remote project names or inspect issue details; no projects were created. Confirm the DSNs map to the existing `ucafe-api` and `ucafe-web` projects before production rollout. Do not create a project per café. Current environments are development/test/production; staging is not configured. Tenant isolation belongs in future event context and access policy, not project count.

### Context and taxonomy

| Field | Source | Placement and rules |
| --- | --- | --- |
| `tenant_id` | Resolved `TenantContext`; for platform actions, only an explicitly authorized target tenant | Opaque internal UUID tag. Never derive it from a caller-supplied body/header. Do not attach a target tenant to unrelated platform events. |
| `request_id` | Server-generated UUID, or a strict UUID supplied by the trusted Next proxy in Phase 2 | Event context/extra, not a tag: it is unique/high-cardinality. Ignore arbitrary caller-selected values and keep it out of user-visible URLs. |
| `feature` | Static allowlist at controller/domain boundary | Low-cardinality tag such as `auth`, `orders`, `reservations`, `subscriptions`, `payments`, `discounts`, `inventory`, `analytics`, `media`, `notifications`, `platform_crm`, or `tenant_crm`. No raw route parsing. |
| `actor_role` | Authenticated request principal after guards | Bounded values such as `platform_user`, `tenant_member`, `client`, `anonymous`; do not attach permission lists, role names from user input, or infer ownership from a URL. |
| `environment` | Explicit deployment config | Sentry's built-in environment value: `development`, `test`, or `production`. Compose passes `SENTRY_ENVIRONMENT` into the web build as `NEXT_PUBLIC_SENTRY_ENVIRONMENT`; tests should be disabled or isolated from production. |
| `release` | Same Git commit used for the paired API/web deployment | Sentry built-in release, recommended stable value `ucafe@<full-git-sha>`. |
| `integration` | Static provider adapter name | Allowlisted values such as `sms_ir`, `zarinpal`, and `object_storage`; never include provider URLs, response bodies, credentials, or per-request identifiers. |

Use Sentry's normalized transaction/route template rather than a custom tag containing the raw URL. An optional user context may contain only the opaque internal `user_id` or `client_id`; omit phone, email, name, username, and IP. Use breadcrumbs only for allowlisted state transitions, provider status codes, and redacted summaries. Never add raw error messages, request bodies, customer text, or IDs as tags.

### Privacy policy

Never intentionally send:

- `Authorization`, cookies, JWTs, refresh/access tokens, internal proxy secrets, or any secret/API key.
- OTP values, passwords, full or masked phone numbers, email addresses, names, customer addresses, or raw SMS parameters/payloads.
- Payment credentials, Zarinpal merchant/authority/callback values, gateway request/response bodies, or webhook secrets.
- Database/Redis/S3 credentials, PII ciphertext, private object keys, presigned URLs, uploaded files, or attachment contents.
- Raw request/response bodies, query strings, URL paths containing resource IDs, CRM notes/custom-field values/feedback text, customer notes, or private ticket content.

Phase 1 disables default PII collection and data collection for user info, cookies, headers, bodies, query values, database query data, stack variables, and source context lines. Both `beforeSend` hooks remove request, user, extra, tags, breadcrumbs, transaction, and logentry fields, then scrub bearer/credential assignments, URLs, emails, and phone-shaped values in event message/exception text. API and browser clients drop breadcrumbs. The browser uses a same-origin `/monitoring` tunnel because UCafe's CSP allows only `connect-src 'self'`. The Next wrapper's default `clientTraceMetadata` injection is removed; no trace headers or spans are configured. Never auto-forward Nest logs. Session Replay stays disabled; if reconsidered later, mask all text/input and block auth, customer, payment, and upload surfaces by default.

The development OTP log is the only confirmed runtime log that directly formats a credential-like value. It must remain excluded from Sentry and production log shipping. The request-ID acceptance rule is an indirect PII logging path as described above. Current raw request paths contain opaque resource IDs; Phase 1 must not copy those paths into tags or event extras.

### Logging and capture policy

Keep the current application logger for container stdout/stderr in Phase 1. Do not forward every log to Sentry.

| Level | Development | Production / Sentry |
| --- | --- | --- |
| `debug` | Local troubleshooting only | Off by default; never shipped wholesale. |
| `info` | Useful lifecycle detail | Keep selective operational startup/health summaries in container logs; successful requests and routine operations are not Sentry events. |
| `warn` | Expected recoverable conditions | Log actionable retry/backlog signals; do not create an event for every retry or expected 4xx. |
| `error` | Unexpected failure detail, still redacted | Phase 1 captures unexpected failures once with a scrubbed stack/message; stable feature/integration context is deferred. |
| `fatal` / critical | Process is unhealthy or stopping | Capture once before termination where possible; let the process supervisor restart it. |

Phase 1 captures unexpected API 5xx and the SDK's default uncaught-exception/unhandled-rejection events. It does not add explicit capture to durable job terminal states. Do not capture declined/canceled payments, invalid input, auth denial, OTP mismatch, expected business conflicts, health checks, routine success, or each transient retry. Future job monitoring should report terminal failure or sustained backlog only, with a fresh job scope and safe durable context.

### Implemented error capture boundaries

- **API:** `main.ts` loads dotenv then `instrument.ts` before Nest imports/bootstrap. `SentryModule.forRoot()` and `UcafeSentryGlobalFilter` capture unknown exceptions and explicitly capture `HttpException` 500+ once; ordinary HTTP exceptions remain excluded. The filter delegates to Nest's base filter, preserving status/body semantics. No custom process handlers were added.
- **Web:** `instrumentation-client.ts` initializes browser capture; `instrumentation.ts` loads server setup and exports `onRequestError`. `error.tsx` and `global-error.tsx` provide safe user-facing boundaries and capture client failures only when the server error has no digest, avoiding boundary duplication. `next.config.ts` sets the same-origin Sentry tunnel and source-map upload settings.
- **Proxy:** `/api/backend/[...path]` returns backend HTTP responses as normal responses and does not call `captureException`; Nest remains the sole reporter for a proxied API 5xx. Unexpected failures thrown by the web proxy remain eligible for Next server error capture.
- **Both:** no tenant, actor, or request-ID context is attached in Phase 1. Workflow `correlation_id` remains separate.

### Release and environment

Use `ucafe@<full-git-sha>` for both projects when API and web ship from the same revision. Supply it as `SENTRY_RELEASE`; Compose also injects it as `NEXT_PUBLIC_SENTRY_RELEASE` at web build and runtime. Later split service releases only if deployment cadence becomes independent. When `SENTRY_AUTH_TOKEN` is supplied as a Compose BuildKit secret, `@sentry/nextjs` uploads maps and removes local `*.map` files after upload. The token was absent in this validation environment, so no remote source-map upload or deployed asset check was possible; production builds must receive a valid token with access to `ucafe-web`. No release automation is part of Phase 1.

Set an explicit Sentry environment (`development`, `test`, `production`) independent of tenant/host. Do not send local/test events to the production environment. DSN absence keeps local runs quiet; automated API tests substitute a fake transport.

### Tracing and quota

Do not enable tracing in Phase 0 or Phase 1. For a later Phase 3, start with a conservative production candidate around 5% of ordinary transactions (tune toward at most 10% only after latency and quota review), exclude health/readiness noise, and raise sampling only for justified operational workflows. Keep error capture independent from trace sampling. Logs remain selective; Session Replay, profiling, and Seer remain off until separately reviewed.

### Phase 1 implementation status — Core Error Monitoring

1. Repository setup uses separate API and web DSNs. Each configured DSN accepted a non-production synthetic event (HTTP 200); the web same-origin tunnel also returned HTTP 200. No authenticated account lookup was available to confirm project names, and no project was created.
2. Added only `@sentry/nestjs` and `@sentry/nextjs` 10.75.3. No tracing, Replay, profiling, Seer, metrics, or log forwarding is configured.
3. API capture initializes before Nest bootstrap. A synthetic Nest test verifies 4xx exclusion, one event for unknown 500 and explicit HTTP 500, sanitization, and unchanged response bodies/statuses using a fake transport. A temporary API exception returned HTTP 500 both directly and through the web proxy; the temporary route was removed.
4. Added Next client/server instrumentation and root/segment boundaries. A temporary App Router server exception returned HTTP 500 through the Sentry-instrumented route; the web SDK and same-origin tunnel independently accepted synthetic events. The API proxy returns backend error responses as ordinary responses and has no manual capture path, avoiding a second web issue.
5. Environment/release configuration and minimum privacy filters are implemented. Phase 1 does not attach request IDs, tenant or actor context.
6. Source-map upload/deletion is configured for builds with `SENTRY_AUTH_TOKEN`; the token was absent here, so upload and production asset exposure still require deployment validation.
7. The test environment was explicitly `development`. Direct Sentry SDK and tunnel deliveries were accepted; the account issue view and event payload at Sentry were not available for inspection. The proxy returned the synthetic backend 500 without throwing, while the API test boundary verified a single capture per exception.

## Risks and out-of-scope findings

- Nest logging remains separate from Sentry because log forwarding is disabled. The HTTP filter is the only API request-error capture point; no extra process handlers were added.
- Notification poll failures can surface as unhandled rejections; automatic process capture must report them once without changing Node's current failure/restart behavior. Per-message retry failures are already caught and should not be captured on every attempt.
- The Next proxy's normal HTTP response forwarding does not create a second web event; unexpected exceptions thrown by the proxy remain separate web failures.
- Sticky global scopes can leak tenant/user metadata between concurrent requests. Use request-local scopes and attach context only after the relevant guards.
- Raw request paths contain identifiers; unique request IDs and tenant IDs can also create high-cardinality tags. Keep IDs in context except the specifically justified opaque `tenant_id` filter.
- Development OTP logs, caller-controlled phone-shaped request IDs, and default HTTP request collection can leak secrets/PII if defaults are trusted. Enforce explicit filtering on both SDKs and at Sentry's server settings.
- API jobs run inside each API replica, not a separate worker. Multiple instances can repeat scans; monitoring should measure durable backlog/terminal outcomes, not polling frequency.
- There is no CI/release pipeline in this repository. Source-map upload and Git-SHA injection need a deployment decision in a later phase. `API_INTERNAL_URL` is also absent from `.env.example` as already noted in [development docs](DEVELOPMENT.md); it is unrelated and unchanged.

## Sources inspected

Product/runtime boundaries: [PRD](PRD.md), [business rules](BUSINESS_RULES.md), [architecture](ARCHITECTURE.md), [backend](BACKEND.md), [frontend](FRONTEND.md), [multi-tenancy](MULTI_TENANCY.md), [authentication](AUTHENTICATION.md), [authorization](AUTHORIZATION.md), [notifications](NOTIFICATIONS.md), [development](DEVELOPMENT.md), [operations](OPERATIONS.md), [decisions](DECISIONS.md), and [current state](CURRENT_STATE.md). CRM boundaries: [Platform CRM README](crm/README.md), [domain model](crm/DOMAIN_MODEL.md), [lifecycle](crm/LIFECYCLE.md), [integrations](crm/INTEGRATIONS.md), [events](crm/EVENTS.md), [automation](crm/AUTOMATION.md), [Tenant CRM README](tenant-crm/README.md), [domain model](tenant-crm/DOMAIN_MODEL.md), [tenant isolation](tenant-crm/MULTI_TENANCY.md), [identity](tenant-crm/IDENTITY.md), [integrations](tenant-crm/INTEGRATIONS.md), [analytics](tenant-crm/ANALYTICS.md), [events](tenant-crm/EVENTS.md), [automation](tenant-crm/AUTOMATION.md), and [Loyalty](tenant-crm/LOYALTY.md).

Implementation: `package.json`, workspace manifests/lockfile, `compose.yaml` and overlays, API/web Dockerfiles, `.dockerignore`, `.env.example`, API `main.ts`/`instrument.ts`/`app.module.ts`/Sentry exception filter/privacy/config/tests, Next instrumentation/error boundaries/Sentry config/privacy hooks, request/tenant middleware, authentication and permission guards, API logger call sites, Next route handler and SSR loader, all scheduled API services, SMS/Zarinpal/S3 adapters, and the worker entry point.
