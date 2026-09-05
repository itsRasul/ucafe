# Cafexa architecture

Status labels: **Implemented**, **Partial**, **Planned**.

## System shape

```text
Browser -> Next.js web (:3000) -> NestJS API (:3001) -> PostgreSQL
                    |                    |             Redis
                    + same-origin proxy +             MinIO (tenant media)
                                         -> SMS provider (development simulator / Kavenegar Lookup)
                                         -> Payment provider (simulator / Zarinpal v4)
Worker scaffold ------------------------------------> future background jobs
```

- **Implemented:** npm monorepo; Next.js 16 standalone output; NestJS 11 REST API under `/api/v1`; PostgreSQL 17; Redis and Docker Compose.
- **Implemented:** the web same-origin proxy at `/api/backend/[...path]` handles interactive reservation calls and was runtime-verified through OTP-authenticated creation.
- **Implemented:** private S3-compatible tenant media storage using MinIO in development, with API-mediated public delivery.
- **Implemented:** authenticated web-to-API tenant-host forwarding, security response headers, structured request IDs and dependency readiness checks.
- **Partial:** Zarinpal checkout/verification is implemented behind configuration and contract-tested; production activation awaits a merchant ID.
- **Planned:** production reverse proxy/TLS/domain routing, real-provider acceptance, queues/background jobs and production observability.

## Backend modules

- `database`: TypeORM connection and tenant/branch/domain entities.
- `tenants`: hostname resolution middleware, public context, provisioning and availability enforcement.
- `identity`: users, memberships, roles and permissions.
- `identity/platform-access`: permission-guarded platform user creation/status, platform/tenant role assignment, role-permission management and read-only permission catalog. Full phone values are returned only by the protected platform user endpoints.
- `authorization`: separate platform and tenant guards/decorators.
- `auth`: OTP challenges, encrypted phone handling, JWT access, rotating refresh sessions and selectable development/Kavenegar SMS providers.
- `subscriptions`: plan, subscription, payment snapshot, trial/prepaid/grace/suspension reconciliation.
- `audit`: append-only platform operator events for provisioning, plan, trial, manual payment and reconciliation changes.
- `site`: website settings, theme normalization and primary-branch opening hours.
- `menu`: category/item/variant CRUD plus public projection.
- `reservations`: branch settings, slot availability, authenticated creation, capacity lock and status workflow.
- `media`: private S3-compatible objects, tenant-scoped metadata, validated logo/hero/gallery upload, focal points, optimized variants and guarded public streaming.
- `notifications`: encrypted database outbox, idempotent reservation-confirmation jobs, bounded retry/backoff and crash recovery.
- `payments`: tenant-owner Silver checkout intents, provider abstraction, public verified callback and idempotent subscription settlement.
- **Planned:** broader worker jobs.

Controllers are transport boundaries; services implement use cases; DTOs validate input; pure utilities hold deterministic rules. Nest exceptions produce standard JSON errors. There is no custom global error envelope yet.

## Frontend

- **Implemented:** Persian RTL root layout; tenant-aware SSR home; branded suspended state; public site/menu/media rendering; responsive styling; `/reserve` four-step client UI; runtime-verified same-origin availability, OTP and pending-reservation flow; shared permission-aware owner shell; reservation management; curated site/theme/contact/hours/media editor; menu category/item/variant CRUD editor; and a separate `/platform` operations surface for tenant provisioning, subscription lifecycle, plan prices and audit history.
- **Planned:** customer reservation history UI, broader design-system extraction and English/LTR presentation.

Public SSR requests use `API_INTERNAL_URL` and the external host. Client mutations use the same-origin web proxy rather than expose internal service addresses. The proxy forwards the existing GET/POST/PATCH/PUT/DELETE operations required by current owner modules and authenticates its internal tenant-host override with `INTERNAL_PROXY_SECRET`; forged or missing secrets fall back to the direct request host.

## Data model

PostgreSQL is the source of truth. Core relationships:

```text
coffee_shops -> branches -> branch_opening_hours
      |            +-----> reservation_settings -> reservations -> users
      +-> domains
      +-> website_settings
      +-> memberships -> membership_roles -> roles -> role_permissions -> permissions
      +-> subscriptions -> subscription_plan
      |                 -> subscription_payments
      +-> payment_intents -> subscription_plan snapshots
      +-> menu_categories -> menu_items -> menu_item_variants
      +-> media_assets -> private S3/MinIO variant objects
users -> auth_sessions / otp_challenges / user_platform_roles
users -> platform_audit_events
reservations -> notification_deliveries
```

Tenant-owned records carry or inherit `coffee_shop_id`. Critical cross-tenant relations use scoped queries and database triggers/constraints. Soft deletion is used for tenant/domain/user/menu records where implemented. TypeORM synchronization is disabled.

## Authentication and authorization

- OTP accepts normalized Iranian mobile numbers. OTP hashes are stored; OTP plaintext is not persisted.
- Phone PII uses authenticated encryption; logs mask phone values. Development SMS prints OTP only outside production.
- Access tokens contain authentication identifiers, not permissions. Database-backed sessions allow revocation and refresh-token rotation/reuse detection.
- Tenant hostname middleware attaches tenant context. `AccessTokenGuard` authenticates; tenant/platform permission guards authorize independently.
- Platform permissions: tenant create/read/update/lifecycle, subscription management, audit read, user read/manage, role read/manage and permission-catalog read. Role permissions remain scope-matched; protected role identity/deletion stays immutable while its permission assignments can be changed without removing the last active role-management path.
- Tenant permissions: site manage, menu read/manage, reservation read/manage, staff manage, subscription read and owner-only subscription checkout.

## API conventions

- REST routes under `/api/v1`; groups are `/public`, `/tenant`, `/platform`, and `/auth`.
- Tenant public and admin routes require resolved hostname context. Public suspended tenants receive HTTP 423 and a stable code/message.
- DTO validation uses whitelist, forbid-non-whitelisted and transformation.
- Money is integer toman stored in numeric columns/strings at persistence boundaries; payment rows retain price snapshots.
- Dates use `YYYY-MM-DD`, times `HH:mm`/PostgreSQL `time`, and tenant/branch timezone defaults to `Asia/Tehran`.

## Reservations

Slot generation is based on same-day opening hours; overnight opening ranges are not supported. Capacity counts overlapping pending/confirmed reservations. Creation uses a PostgreSQL advisory transaction lock per branch/date and rechecks availability. MVP manages guest capacity, not physical tables.

## Subscription lifecycle

An explicit seven-day trial leads to suspension if unpaid. Paid service is prepaid by calendar month; after period end it enters seven-day grace, then suspension. Public access reconciliation can update effective status. Silver checkout stores an immutable toman snapshot, converts to rials only at the gateway boundary, and verifies the intent authority and snapshot amount server-side. A unique authority plus tenant/idempotency key prevents double credit; verified settlement immediately marks the subscription and coffee shop active. Stale verification claims recover after five minutes and a payment row written before an interrupted intent update is reconciled on the next callback. Scheduled reconciliation remains planned.

## Files, caching and jobs

- **Implemented:** the `cafexa-media` bucket remains private. Image bytes are decoded and limited to JPEG/PNG/WebP, 8 MB and 24 megapixels, with role-specific minimum dimensions. The API creates small/large AVIF and WebP crops, stores only tenant/asset-prefixed keys, and serves immutable variants through hostname-resolved public routes. Logo and hero are single slots; gallery is capped at eight; focal points and gallery order are bounded metadata. Missing/deleted media uses the existing stable CSS layout.
- **Implemented:** uploads are currently processed synchronously in the API because Phase 10 excludes a worker pipeline. Original upload bytes are not retained or publicly served.
- Redis is configured and used by authentication for rate limiting/ephemeral OTP controls; broader tenant-config caching is planned.
- Reservation confirmation delivery currently runs as a bounded API-hosted outbox dispatcher; unique reservation/type keys prevent duplicate jobs, stale claims recover, and failures retry three times with exponential backoff. A dedicated horizontally coordinated worker remains launch hardening.

## Configuration and logging

API environment variables are validated with Joi. `.env.example` documents names only; real secrets stay local/hosted. Nest logging is used. No production centralized logging, tracing or metrics exists yet. Sensitive bodies, OTPs in production, tokens and full phones must never be logged.

The API emits structured `http_request` events containing request ID, method, path, status and duration, but no bodies, tokens or client identifiers. `/health` is liveness-only; `/health/ready` verifies PostgreSQL, Redis and the private object bucket. Production configuration refuses development SMS, simulated payments and non-HTTPS payment callbacks.

## Docker and environments

Compose defines API, web, PostgreSQL, Redis and health-checked MinIO; API startup ensures the private media bucket exists. Local images currently inherit a locally available `backend-app:latest` base because earlier Docker Hub access was unreliable. The `.dockerignore` does not exclude all generated output, producing very large build contexts; this is technical debt.

Production remains planned: reverse proxy, TLS, DNS/wildcard/custom domains, secret management, backups, migration release procedure, health/readiness, resource limits and monitoring must be designed before launch. Pars Web Server is an acceptable hosting provider to investigate, not a confirmed deployment architecture.

## Testing strategy

- Implemented API unit tests use Node’s test runner through ts-node for hostname, auth crypto/tokens/phone, guards, lifecycle, theme, menu validation, reservation slot/date rules and media decoding/optimization limits.
- Type checks exist for all workspaces; builds exist for API/web/worker. There is no lint command.
- Migrations are checked/applied against PostgreSQL.
- Live checks have covered public context/site/menu, auth, subscription behavior, availability, reservation creation, dependency readiness, authenticated proxy forwarding, security headers and SSR performance budgets.
- Simulated gateway integration checks cover callback verification, immediate activation and duplicate-callback no-double-credit behavior; the real Zarinpal request/verify payload is mocked in unit tests.
- Browser testing is required for UI phases. Full end-to-end automation, accessibility automation, load tests and security tests are planned.

## Scaling and security posture

The stateless API/web can scale horizontally once session/cache dependencies and proxy routing are productionized. PostgreSQL is shared multi-tenant storage; indexes exist for tenant/menu/reservation access. Future hotspots should use caching/queues rather than tenant-specific deployments. Security headers, authenticated proxy forwarding, backup/restore testing, dependency audit and operator runbooks are implemented. Production still requires hosting-specific threat review, TLS/proxy verification, monitoring destinations, provider acceptance and ongoing image/dependency scanning.
