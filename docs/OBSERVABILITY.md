# Observability and Sentry

## Scope

This document records the Phase 0 audit, Phases 1–2 error/log/request context, and Phase 3 tracing configuration. Sentry account-side alerts and uptime monitors still require authenticated project access; replay and profiling remain disabled.

## Sentry Failure Policy

Sentry telemetry is best-effort and fail-open. Sentry is a downstream observability consumer, never a correctness dependency: Sentry failure or latency must not affect UCafe business operations, HTTP responses, database commits, frontend interactions, or application availability. This rule applies to Sentry Logs, tracing, performance monitoring, and any future observability instrumentation.

Normal request paths call the synchronous SDK capture APIs without awaiting delivery. The SDK processes events and sends them through its transport asynchronously; transport rejection is handled by the SDK. Request handlers, controllers, services, filters, middleware, interceptors, route handlers, and transactions must not await telemetry delivery or call `flush()` / `close()`. No API or web runtime callsite currently flushes or closes Sentry. `flush()` is allowed only in explicit integration tests or a justified short-lived process; graceful-shutdown flushing may be added only with a strict bound and fail-open handling.

Sentry DSN, environment, and release are optional telemetry settings and are not part of API startup validation. Missing DSNs disable the corresponding SDK client. A malformed DSN is rejected by the SDK and leaves telemetry disabled; it must not prevent UCafe startup. Do not include the DSN value in application diagnostics.

No business transaction waits on or directly captures to Sentry. API exceptions use the global filter; the sole application-log bridge is an explicit helper for selected terminal operational failures. Web capture is confined to Next.js request instrumentation and the two error-boundary effects; those boundaries render their normal UCafe fallback without waiting for event delivery.

The API reliability test uses an injected fake transport that rejects and one that stays pending, including with trace sampling enabled. It verifies the UCafe response still completes and transport rejection creates no unhandled rejection. A prior live Next.js browser check triggered the client error boundary with rejecting and pending fake transports; both kept the user-facing fallback visible. Tests may explicitly use bounded `flush()` / `close()` calls to drain their fake transport.

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
- The proxy forwards the request body, query, authorization, and cookie to the API. It forwards a canonical `x-request-id`, returns the API's validated ID to the caller, and keeps the existing selected response-header and refresh-cookie behavior.

### Logging

- Runtime code still uses Nest `Logger` directly. A small explicit `logOperationalFailure` helper writes a normalized JSON record through that logger and forwards only opted-in warn/error entries through the SDK's structured log API. No logger provider replacement, Winston/Pino dependency, custom transport, or remote sender was added. Docker stdout/stderr remains the primary log stream.
- The request middleware logs only request ID, route-family feature, method, status, and duration; it no longer writes raw path segments. Routine request logs remain local. Existing inventory/service logs are not globally forwarded.
- Notification and CRM job logs use event/type/status or opaque entity IDs. Two inventory error paths include an exception stack. CLI `console.log` usage is limited to tenant provisioning and platform-owner bootstrap output; provisioning prints its result, while bootstrap prints an opaque user ID and role key. These are operator command outputs, not request telemetry, and must not be forwarded to Sentry. Database audit rows and domain outboxes are business records, not general telemetry.
- **Privacy finding:** [development SMS](../apps/api/src/auth/development-sms.provider.ts) logs the plaintext OTP and a masked phone. Its constructor rejects `NODE_ENV=production`, and the API schema also requires the real SMS provider in production. This is a development-only credential exposure: development logs must never be forwarded to the production Sentry environment. No production-path OTP logging was found.

### Request and tenant context

- API and web accept only UUIDv4 request IDs; missing or invalid values are replaced with a fresh UUIDv4. The API validates independently and preserves its `x-request-id` response header. The Next proxy forwards the canonical ID and returns the API's canonical response header. SSR API calls also send a validated or server-generated UUIDv4. Caller-selected valid UUIDs are safe correlation hints, never identity or authorization.
- Request IDs are attached to Sentry's `contexts.request.id` and structured-log attributes, never tags. No request ID or raw URL/query is added to browser state.
- `TenantContextMiddleware` resolves the normalized host through an active `domains` row and attaches an opaque `coffeeShopId`, slug, status, locale, timezone, hostname, and domain type to that Express request. It runs only for public and tenant route families. It does not trust an arbitrary tenant ID from a public DTO. Platform requests have no implicit tenant context; tenant-targeted platform actions identify their target explicitly.
- Administrative authentication still attaches only opaque `userId`/`sessionId` request data. The observability context is separate Node `AsyncLocalStorage`, created inside a fresh Sentry isolation scope per HTTP request. Verified tenant middleware adds only the internal tenant UUID. Successful permission/client guards set the bounded actor category; no IDs, names, phones, email, role permissions, or Sentry user object are sent.
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

- The configured deployment environments are `development` and `production`; API also permits `test`. Staging is not configured. `SENTRY_ENVIRONMENT` overrides the Sentry event label and otherwise falls back to `NODE_ENV`; the optional telemetry label is not startup-validated.
- No release value is currently configured by Compose or tracked CI. Compose passes `SENTRY_RELEASE` through when supplied and also passes it to the web build as `NEXT_PUBLIC_SENTRY_RELEASE`.
- [API Sentry config](../apps/api/src/observability/sentry-options.ts) disables capture without `SENTRY_DSN`; web uses `NEXT_PUBLIC_SENTRY_DSN` in the browser and `SENTRY_DSN` at runtime. Sentry variables are excluded from API's required environment validation so malformed optional telemetry settings cannot block startup. Compose passes the web public DSN/environment/release at both build time and runtime so development and production clients can initialize. Automated API tests use a fake in-memory transport, never a real DSN.

| Variable | Service and phase | Classification | Behavior |
| --- | --- | --- | --- |
| `SENTRY_DSN` | API runtime; web runtime | Optional runtime configuration | Separate project DSN for the API. Compose maps the public web DSN to web runtime `SENTRY_DSN`. Blank/unset disables that client. |
| `NEXT_PUBLIC_SENTRY_DSN` | Web build and runtime/browser | Optional, public/browser-safe configuration | Web project DSN compiled into production browser instrumentation and passed to the development client; not an auth credential. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Web build and runtime/browser | Optional, public/browser-safe configuration | Set by Compose from `SENTRY_ENVIRONMENT` so browser events use the same environment as the web server. |
| `SENTRY_ENVIRONMENT` | API/web runtime | Optional runtime configuration | Explicit SDK environment; unset falls back to `NODE_ENV`. Use `development`, `test`, or `production` to match the current deployment labels; any value only labels telemetry and cannot block startup. |
| `SENTRY_TRACES_SAMPLE_RATE` | API/web runtime; web build | Optional non-secret runtime/build configuration | Valid range is `0`–`1`. Defaults to `0.05` in production and `1` in development; tests, unknown environments, invalid values, and missing DSNs disable tracing. Set explicitly to `0` to turn tracing off. Compose passes it to the web build and runtime. |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | Web build/runtime/browser | Optional public configuration | Compose derives this from `SENTRY_TRACES_SAMPLE_RATE`. Set it directly only for standalone web deployments that do not use this Compose mapping. |
| `SENTRY_RELEASE` | API/web runtime and web build | Optional runtime/build configuration | External deployment release value; provide the Git SHA when available. |
| `NEXT_PUBLIC_SENTRY_RELEASE` | Web build and runtime/browser | Optional, public/browser-safe configuration | Set by Compose from `SENTRY_RELEASE` so browser events use the same release. |
| `SENTRY_AUTH_TOKEN` | Web image build only | Optional build-time secret | BuildKit secret for source-map upload. It is not a build arg or runtime environment variable and is not copied into the final image. |
- Authentication/session rules keep OTPs out of persistence, hash access/session tokens, encrypt stored phone/outbox data, and use HttpOnly refresh cookies. These controls do not automatically sanitize error events. Tenant CRM notes, preferences/custom fields, feedback, customer identity, order/reservation data, payment authority/reference values, uploaded media, and provider credentials must be treated as sensitive even when an exception occurs near them.

## Phase 0 decisions and later-phase boundaries

### Explicitly deferred

- **Phase 3 account work:** production error/spike alert routing and web/API uptime monitors. These require authenticated Sentry project access and are not configured from this checkout.
- **Not enabled:** Session Replay, profiling, Seer, automatic log forwarding, Redis tracing, custom metrics, cron monitoring, and advanced dashboards.

### Project architecture

Use the `ucafe` organization with exactly two application projects:

- `ucafe-api`: Nest HTTP failures, selected API/integration failures, and terminal background-job failures.
- `ucafe-web`: Next server-rendered, route-handler, and unhandled client application failures. Do not recapture ordinary API error responses already reported by `ucafe-api`.

The web build is configured for organization `ucafe` and project `ucafe-web`; API project selection is determined by its separately supplied `SENTRY_DSN`. In earlier development validation, the configured API and web DSNs each accepted a synthetic event with HTTP 200, and a web event sent through `/monitoring` was also accepted with HTTP 200. No authenticated Sentry integration was available to inspect remote project names or event payloads; no projects were created. Confirm the DSNs still map to `ucafe-api` and `ucafe-web` before production rollout. Do not create a project per café. Current environments are development/test/production; staging is not configured. Tenant isolation is enforced in each API request scope; it does not require a project per tenant.

### Context and taxonomy

| Field | Source | Placement and rules |
| --- | --- | --- |
| `tenant_id` | Active-host `TenantContextMiddleware` after the domain row and tenant status are verified | Opaque internal UUID Sentry tag and log attribute. Never derive it from request body/header/path. Absent on platform requests. |
| `request_id` | Strict UUIDv4 accepted or generated at Next/API boundary | `contexts.request.id` and structured-log attribute, never a tag. High-cardinality; not an identity or authorization value. |
| `feature` | Stable route-family mapping at API request start; static web route mapping for browser events | Allowlisted tag/log attribute: `auth`, `menu`, `orders`, `reservations`, `payments`, `subscriptions`, `inventory`, `analytics`, `discounts`, `platform_crm`, `tenant_crm`, `media`, `notifications`, or `platform`. Raw routes and query strings are not attached. |
| `actor_role` | Anonymous default, then successful tenant/platform/client guard | Bounded categories: `platform_admin`, `tenant_owner`, `tenant_staff`, `client`, `anonymous`, or `system`. UCafe has no `tenant_admin` role; the current non-owner tenant role is `content_editor`, categorized as staff. No actor ID or Sentry user object is sent. |
| `environment` | Explicit deployment config | Sentry's built-in environment value. Use `development`, `test`, or `production`; Compose passes `SENTRY_ENVIRONMENT` into the web build as `NEXT_PUBLIC_SENTRY_ENVIRONMENT`. |
| `release` | Same Git commit used for the paired API/web deployment | Sentry built-in release, recommended stable value `ucafe@<full-git-sha>`. |
| `integration` | Static provider boundary, only where relevant | Allowlist: `sms_ir`, `zarinpal`, `minio`, `redis`, `postgres`. Currently emitted by the terminal SMS delivery log as `sms_ir`; never attach provider URLs, response bodies, credentials, or per-request identifiers. |

`tenant_id`, `feature`, `actor_role`, and `integration` are the only API event tags retained by the sanitizer. Request IDs and selected opaque record IDs belong in context/log attributes. Environment and release remain Sentry built-ins. No URL, raw path, query, breadcrumb, body, customer text, or actor identifier is retained.

### Privacy policy

Never intentionally send:

- `Authorization`, cookies, JWTs, refresh/access tokens, internal proxy secrets, or any secret/API key.
- OTP values, passwords, full or masked phone numbers, email addresses, names, customer addresses, or raw SMS parameters/payloads.
- Payment credentials, Zarinpal merchant/authority/callback values, gateway request/response bodies, or webhook secrets.
- Database/Redis/S3 credentials, PII ciphertext, private object keys, presigned URLs, uploaded files, or attachment contents.
- Raw request/response bodies, query strings, URL paths containing resource IDs, CRM notes/custom-field values/feedback text, customer notes, or private ticket content.

Both clients disable default PII collection and collection of user info, cookies, headers, bodies, query values, database query data, stack variables, and source context lines. API error events keep only validated allowlist tags, request ID, and validated trace/span IDs; web error events keep only a safe `feature` tag and validated request/trace IDs. Both scrub bearer/credential assignments, URLs, emails, phone-shaped values, OTPs, and JWT-looking strings from messages. Error events drop request/user/extra/breadcrumb/transaction/logentry data. Trace transactions/spans use a separate allowlist: only stable HTTP method/status/route and DB system/operation fields survive; SQL text, URLs, unknown attributes, and span links are removed, and database descriptions are reduced to a generic operation. UUIDs, long numeric route IDs, and query strings are normalized/removed. API structured logs pass an attribute allowlist and the same text scrubber before Sentry delivery. The web Sentry Logs feature is disabled. The browser uses the existing same-origin `/monitoring` tunnel; Session Replay and profiling stay disabled.

The development OTP logger still writes its local diagnostic and is never passed through the Sentry bridge. Request IDs are UUID-only and raw request paths are omitted from request logs and Sentry events.

### Logging and capture policy

Keep Nest `Logger` as the container stdout/stderr sink. `logOperationalFailure` writes locally first and forwards only explicit terminal operational failures; it never replaces the primary log sink.

| Level | Development | Production / Sentry |
| --- | --- | --- |
| `debug` | Local troubleshooting only | Off by default; never shipped wholesale. |
| `info` | Useful lifecycle detail | Keep selective operational startup/health summaries in container logs; successful requests and routine operations are not Sentry events. |
| `warn` | Expected recoverable conditions | Keep retries local; selected terminal SMS delivery exhaustion is one Sentry structured log with safe feature/integration/tenant/error-code context. |
| `error` | Unexpected failure detail, still redacted | Sentry issue owns uncaught API failures; do not forward an identical error log. The helper supports explicit distinct operational error logs. |
| `fatal` / critical | Process is unhealthy or stopping | Capture once before termination where possible; let the process supervisor restart it. |

API captures unexpected 5xx once. The selected notification log is sent only after bounded SMS retries are exhausted; ordinary retries, 4xx, health checks, and success remain local or silent. No automatic Nest logger forwarding or cron monitoring is enabled. Background work does not inherit an HTTP tenant/actor/request context; job metadata must be explicit.

### Implemented error capture boundaries

- **API:** `main.ts` loads Sentry instrumentation before Nest bootstrap. `requestObservability` validates/creates a UUIDv4 and opens a fresh Sentry isolation scope plus Node AsyncLocalStorage. Tenant middleware and successful auth guards add only safe tenant/actor categories. The global filter preserves the Phase 1 issue boundary and Nest response semantics.
- **Web:** server request errors receive a validated/generated request context and a stable route-family feature. Browser errors receive only a feature derived from the current route; no tenant or actor data is added to browser state. Error boundaries remain unchanged.
- **Proxy:** `/api/backend/[...path]` returns backend HTTP responses as ordinary responses, forwards a canonical request ID, and returns the API ID. Nest remains the sole reporter for a proxied API 5xx. SSR API calls also send a canonical ID.
- **Logs:** the official SDK `logger.warn/error` API is enabled only in API config behind the explicit `logOperationalFailure` bridge. No normal API or web path flushes or waits for telemetry.

### Release and environment

Use `ucafe@<full-git-sha>` for both projects when API and web ship from the same revision. Supply it as `SENTRY_RELEASE`; Compose also injects it as `NEXT_PUBLIC_SENTRY_RELEASE` at web build and runtime. Later split service releases only if deployment cadence becomes independent. When `SENTRY_AUTH_TOKEN` is supplied as a Compose BuildKit secret, `@sentry/nextjs` uploads maps and removes local `*.map` files after upload. The token was absent in this validation environment, so no remote source-map upload or deployed asset check was possible; production builds must receive a valid token with access to `ucafe-web`. No release automation is part of Phase 1.

Set an explicit Sentry environment (`development`, `test`, `production`) independent of tenant/host. Do not send local/test events to the production environment. DSN absence keeps local runs quiet; automated API tests substitute a fake transport.

### Tracing and quota

Tracing is enabled when the corresponding DSN exists and the validated rate is greater than zero. The default is 5% in production, 100% in development, and 0% in tests or unknown environments; an invalid explicit rate safely disables tracing. Error capture is independent of trace sampling. Health/readiness, Next static assets, favicon, and the Sentry tunnel are excluded. No route-specific boosts or manual span scaffolding are added.

Browser navigation/fetch spans are enabled in the web client. Next.js server work and outbound HTTP/fetch spans use the Sentry Next/Node integrations. The browser propagates trace headers only to same-origin `/api/backend/...`; the Next server propagates only to the exact origin and API base path configured by `API_INTERNAL_URL`. The API accepts optional upstream trace context and samples direct requests independently. API SDK-managed outbound trace propagation is disabled, so provider calls do not receive Sentry headers. Nest HTTP spans and PostgreSQL spans (official `postgresIntegration`) are enabled when tracing is sampled. Redis is not instrumented: the app has no Redis client operations, only a manual TCP readiness ping. External HTTP spans may record sanitized timing where the SDK supports them, without propagating headers.

Sentry span/transaction sanitizers preserve only low-cardinality diagnostics. They retain no request bodies, SQL or bind values, URL query data, tenant/client text, credentials, or arbitrary integration attributes. Existing Phase 2 AsyncLocalStorage/Sentry isolation keeps tenant tags request-local; `request_id` remains a separate operational correlation value and is never replaced by `trace_id`.

Use Sentry's trace/performance views to investigate public menu loading, order creation, reservation creation, admin dashboard reads, analytics, inventory operations, and payment initiation/callback latency. No per-service custom instrumentation or arbitrary latency alert threshold is configured. Performance alerting waits for a production baseline.

### Phase 1 implementation status — Core Error Monitoring

1. Repository setup uses separate API and web DSNs. Each configured DSN accepted a non-production synthetic event (HTTP 200); the web same-origin tunnel also returned HTTP 200. No authenticated account lookup was available to confirm project names, and no project was created.
2. Added only `@sentry/nestjs` and `@sentry/nextjs` 10.75.3. No tracing, Replay, profiling, Seer, metrics, or log forwarding is configured.
3. API capture initializes before Nest bootstrap. A synthetic Nest test verifies 4xx exclusion, one event for unknown 500 and explicit HTTP 500, sanitization, and unchanged response bodies/statuses using a fake transport. A temporary API exception returned HTTP 500 both directly and through the web proxy; the temporary route was removed.
4. Added Next client/server instrumentation and root/segment boundaries. A temporary App Router server exception returned HTTP 500 through the Sentry-instrumented route; the web SDK and same-origin tunnel independently accepted synthetic events. The API proxy returns backend error responses as ordinary responses and has no manual capture path, avoiding a second web issue.
5. Environment/release configuration and minimum privacy filters are implemented. Phase 1 does not attach request IDs, tenant or actor context.
6. Source-map upload/deletion is configured for builds with `SENTRY_AUTH_TOKEN`; the token was absent here, so upload and production asset exposure still require deployment validation.
7. The test environment was explicitly `development`. Direct Sentry SDK and tunnel deliveries were accepted; the account issue view and event payload at Sentry were not available for inspection. The proxy returned the synthetic backend 500 without throwing, while the API test boundary verified a single capture per exception.

### Phase 1.5 implementation status — Fail-open reliability

1. Removed optional `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE` from API startup validation. Missing, malformed, or unfamiliar telemetry values cannot fail API configuration validation; missing DSN disables capture and the SDK rejects a malformed DSN without throwing.
2. Extended the fake-transport API test to verify a rejected send preserves Nest's normal 500 response, a successful request completes during a failed or pending send, and transport rejection creates no `unhandledRejection`. The existing available-transport test still verifies capture and response preservation.
3. Simulated a client exception in the live Next.js error boundary with fake rejecting and never-resolving transports; the Persian fallback rendered in both cases. The temporary route was removed after the check.
4. Reviewed every API and web capture callsite. The API global filter is the only backend request capture point; the web uses Next request instrumentation and the two error boundaries. No capture occurs in business services or database transactions, and no runtime request path calls `flush()` or `close()`.
5. Root `npm test` passed (210 passed, 34 database-backed tests skipped because their dedicated integration database variables were unset); root typecheck and build passed. There is no lint script. Live API and web health endpoints returned HTTP 200.

## Outstanding risks and out-of-scope findings

- Nest logging remains the local primary sink; only the explicit terminal notification failure uses Sentry Logs. The HTTP filter remains the API request-error capture point; no process handlers were added.
- Notification poll-level failures can still surface as unhandled rejections; Phase 2 did not change timer failure/restart behavior. Per-message SMS retries remain local until exhausted.
- The Next proxy's normal HTTP response forwarding does not create a second web event; unexpected exceptions thrown by the proxy remain separate web failures.
- Concurrent tenant scope isolation and tenant-to-platform clearing are covered by the Sentry integration test. Request IDs are UUIDv4 only; raw paths are omitted from request logs and Sentry events. Sentry server-side project settings should retain their own PII controls.
- Development OTP logs remain local and must not be exported by external log shipping. The in-app bridge does not forward that logger.
- API jobs run inside each API replica, not a separate worker. Multiple instances can repeat scans; monitoring should measure durable backlog/terminal outcomes, not polling frequency.
- There is no CI/release pipeline in this repository. Source-map upload and Git-SHA injection need a deployment decision in a later phase. `API_INTERNAL_URL` is also absent from `.env.example` as already noted in [development docs](DEVELOPMENT.md); it is unrelated and unchanged.

## Phase 2 implementation status — Tenant context, correlation, and structured logs

- API request IDs are strict UUIDv4 values. Next generates or accepts a UUIDv4 and propagates it through the proxy; Nest repeats validation for direct calls. API responses preserve `x-request-id`, and the proxy returns that safe value to its caller. SSR API fetches send a canonical ID too.
- API Sentry context uses a per-request `Sentry.withIsolationScope` plus Node `AsyncLocalStorage`. Verified host resolution sets `tenant_id`; platform requests start with a clean scope and no tenant. Successful guards set `actor_role`; no actor ID or PII is sent. Request ID is in `contexts.request.id`, not a tag.
- API feature tags come from a stable route-family allowlist. Browser errors get only a mapped feature; server-rendered web errors also get a validated/generated request context. Browser telemetry receives no tenant or actor identity.
- The API Sentry sanitizer retains only allowlist tags and request ID context, scrubs message/exception/log text, and restricts structured log attributes. Web Sentry Logs are disabled. API structured logs use the official SDK logger only through the opt-in helper; only exhausted SMS delivery retries are forwarded today. Existing retries and request summaries remain local stdout/stderr.
- Focused tests cover malformed/missing/valid IDs, synthetic PII, 16 concurrent tenant requests followed by platform requests, safe tags/context, and failed/stalled log and exception transports. One synthetic API issue, one API structured log, and one Web issue were sent with development DSNs; each SDK flush completed. The Sentry project views were not available for payload inspection, so fake transports remain the verification of exact sanitized envelope contents.

## Phase 3 implementation status — tracing and account operations

- API and web use the already-pinned Sentry SDK 10.75.3. Production defaults to 5% trace sampling; development defaults to 100%; tests/unknown environments default to zero. An explicit `SENTRY_TRACES_SAMPLE_RATE` must be a finite value from 0 through 1; invalid values disable traces without disabling error reporting.
- Browser spans propagate only to same-origin `/api/backend/...`; Next server spans propagate only to the API origin/base path in `API_INTERNAL_URL`. API accepts optional parent context and does not send trace headers to other destinations. Direct API calls can start sampled traces without an incoming trace.
- Sampled transactions include browser navigation/fetch, Next server work/fetch, Nest HTTP, and PostgreSQL spans. Redis is not instrumented because UCafe has no application Redis client operations. Database query data, span links, unknown span attributes, URL queries, and sensitive descriptions are removed by Sentry callbacks. Health/readiness and static/tunnel noise are excluded.
- The integration test exercises sampled API tracing with rejecting and stalled transports and checks ordinary success/error responses remain available. Exact sanitized transaction/span contents are checked through pure sanitizer tests. Tenant context continues to use the Phase 2 request-isolated scope.
- No authenticated Sentry account tool or project view was available in this session. No production issue alert, error-spike alert, uptime monitor, notification route, or remote trace/payload inspection is claimed as configured. Use the existing `ucafe-api` and `ucafe-web` projects; route production actionable-error alerts to the account's existing team destination. Configure public HTTPS uptime checks for web `/health` and API `/api/v1/health`, expecting 200. The API `/api/v1/health/ready` endpoint is dependency readiness and is not the liveness monitor target.
- Manual account setup: in each project, add one first-seen/actionable error alert filtered to `environment:production` and route it to the existing team notification action. The API already omits expected 4xx. Once production event volume has a baseline, add at most one production error-count/spike metric alert using a threshold justified by that baseline. Create two Sentry Uptime checks against the deployed public HTTPS web origin `/health` and API origin `/api/v1/health`, expecting 200, and route failures to the same existing team destination. Replace the origins with the actual deployed public hostnames; do not use local or Docker hostnames.
- Keep the error-spike alert deferred until the Sentry account confirms a supported alert type and production traffic establishes a useful baseline. Keep performance alerts deferred until there is a latency baseline. Do not notify on expected 4xx traffic; API expected HTTP errors remain excluded by the existing Phase 1 capture policy.
- Development Compose rebuilt and started successfully. Web `/health`, API `/api/v1/health`, and API `/api/v1/health/ready` returned 200; a read-only public-menu request through the Next proxy returned 200. Eight warmed menu requests per setting measured local median latency of 73.7 ms at sample rate 0 and 86.6 ms at sample rate 1 (12.9 ms difference). This small development sample shows no blocking, but is not a production performance baseline.
- The read-only menu path was exercised locally with tracing set to 100%, including the Next proxy and API. Remote trace linkage and payload contents were not visible in an authenticated Sentry project view; production alert rules, uptime checks, and notification delivery also remain unverified and require Sentry account access plus the public production origins.

## Sources inspected

Product/runtime boundaries: [PRD](PRD.md), [business rules](BUSINESS_RULES.md), [architecture](ARCHITECTURE.md), [backend](BACKEND.md), [frontend](FRONTEND.md), [multi-tenancy](MULTI_TENANCY.md), [authentication](AUTHENTICATION.md), [authorization](AUTHORIZATION.md), [notifications](NOTIFICATIONS.md), [development](DEVELOPMENT.md), [operations](OPERATIONS.md), [decisions](DECISIONS.md), and [current state](CURRENT_STATE.md). CRM boundaries: [Platform CRM README](crm/README.md), [domain model](crm/DOMAIN_MODEL.md), [lifecycle](crm/LIFECYCLE.md), [integrations](crm/INTEGRATIONS.md), [events](crm/EVENTS.md), [automation](crm/AUTOMATION.md), [Tenant CRM README](tenant-crm/README.md), [domain model](tenant-crm/DOMAIN_MODEL.md), [tenant isolation](tenant-crm/MULTI_TENANCY.md), [identity](tenant-crm/IDENTITY.md), [integrations](tenant-crm/INTEGRATIONS.md), [analytics](tenant-crm/ANALYTICS.md), [events](tenant-crm/EVENTS.md), [automation](tenant-crm/AUTOMATION.md), and [Loyalty](tenant-crm/LOYALTY.md).

Implementation: `package.json`, workspace manifests/lockfile, `compose.yaml` and overlays, API/web Dockerfiles, `.dockerignore`, `.env.example`, API `main.ts`/`instrument.ts`/`app.module.ts`/Sentry exception filter/privacy/config/tests, Next instrumentation/error boundaries/Sentry config/privacy hooks, request/tenant middleware, authentication and permission guards, API logger call sites, Next route handler and SSR loader, all scheduled API services, SMS/Zarinpal/S3 adapters, and the worker entry point.
