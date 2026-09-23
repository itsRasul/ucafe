# Architecture

## System

```text
Browser
  -> Next.js 16 web (:3000)
       -> server-rendered platform/tenant pages
       -> same-origin /api/backend proxy
            -> NestJS 11 REST API (:3001, /api/v1)
                 -> PostgreSQL 17 (system of record)
                 -> private S3/MinIO (generated image variants)
                 -> Redis 7 (readiness only; reserved for future ephemeral work)
                 -> sms.ir or development SMS provider
                 -> Zarinpal or simulated payment gateway

Nest worker scaffold (not connected to jobs)
```

The npm-workspace monorepo contains `apps/web`, `apps/api`, `apps/worker`, and shared TypeScript configuration under `packages/`. API code is domain-oriented; the web uses the Next App Router.

## Runtime boundaries

### Web

The root page distinguishes platform host from tenant subdomains. Tenant SSR loads context/site/menu/ordering from the internal API using the external host. Interactive client calls use `/api/backend/[...path]`, keeping the browser same-origin and internal addresses private.

The proxy forwards authorization/cookies and an authenticated tenant-host override. See [MULTI_TENANCY.md](MULTI_TENANCY.md). Next emits CSP, frame/content/referrer/permissions headers and HSTS in qualifying production domains.

### API

The API exposes REST groups under `/api/v1`: `/public`, `/auth`, `/tenant`, `/platform`, and `/health`. Global validation whitelists/transforms DTO input and rejects unknown properties. Controllers handle transport/identity metadata; services own use cases and transactions; entities map persistence; small utilities hold deterministic rules.

Major modules: tenants, identity/authorization, auth, clients, subscriptions, site, menu, media, ordering, analytics, reservations, notifications, payments, platform consultation requests, audit, and health. Analytics definitions and extension points are in [ANALYTICS.md](ANALYTICS.md).

### Data and infrastructure

PostgreSQL is authoritative for business data, session/outbox state, constraints, advisory locks, and lifecycle records. TypeORM synchronization and automatic migration execution are disabled in application configuration; production API startup currently runs migrations before starting the server.

MinIO/S3 objects are private fixed media variants keyed by tenant/asset. Redis is mandatory in configuration and readiness but has no current application cache/rate-limit usage. The worker only starts a Nest application context.

## Core relationships

```text
coffee_shops
  -> branches -> opening_hours / reservation_settings -> reservations
  -> domains
  -> website_settings / media_assets / menu_categories -> menu_items -> variants
  -> memberships -> membership_roles -> roles -> permissions
  -> clients -> client_sessions / addresses / orders / reservations
  -> subscription -> plan / subscription_payments
  -> payment_intents
  -> notification_deliveries

users -> auth_sessions / platform_roles / memberships / platform_audit_events
orders -> order_items
```

See [DATABASE.md](DATABASE.md) for important constraints without duplicating the schema.

## Key flows

- **Tenant request:** host → domain → effective subscription/cafe status → tenant context → public or authenticated guard → tenant-scoped service query.
- **Client action:** cafe-scoped OTP/session → client JWT tied to resolved cafe → owned resource query.
- **Order:** feature/settings checks → server-side menu validation/pricing → transaction/snapshots → outbox.
- **Reservation:** feature/slot checks → branch/date advisory lock → capacity recheck → transaction/outbox.
- **Renewal:** owner permission → immutable payment intent → public authority callback → provider verification → idempotent subscription payment/reactivation.
- **Notification:** business transaction inserts encrypted unique outbox row → API timer claims/retries → current-state eligibility check → provider.

## Deployment topology

Docker images use Node 22 `bookworm-slim` with development, builder, and production stages. Compose runs separate web/API containers with PostgreSQL 17 Alpine, Redis 7 Alpine, and MinIO. Production expects a TLS reverse proxy in front of web and the payment callback, private east-west API/data/object access, managed secrets/backups, and readiness-based traffic. The repository does not define the final reverse-proxy or hosting implementation.

## Security boundaries

- Host-derived tenant context and scoped queries/constraints protect tenant separation.
- Platform, tenant-admin, and client authentication/authorization are independent.
- Provider callbacks prove payment only after server-side verification; browser redirects are not proof.
- Client prices, tenant headers, role visibility, and frontend feature hiding are untrusted.
- Sensitive request bodies, phones, OTPs, tokens, encryption/provider keys, and object credentials must not enter logs or public responses.

## Scaling limits

Web/API are structurally stateless around shared stores, but notification polling/scheduling is not designed for efficient horizontal API replication. Conditional claims prevent duplicate delivery while replicas still duplicate scans and scheduled sweeps. Synchronous image transformation and public-access subscription reconciliation also remain API-hosted. Move those to coordinated background work only when production load/topology requires it.
