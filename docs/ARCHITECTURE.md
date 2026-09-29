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

Major modules: tenants, identity/authorization, auth, clients, subscriptions, site, menu, promotions, media, ordering, inventory, analytics, reservations, support tickets, notifications, payments, Tenant CRM, platform consultation requests, Platform CRM (Organizations, Contacts, Leads, Deals, Activities, Tasks, Notes, lifecycle history, and Phase 9 Workflow automation), audit, and health. CRM customer context composes bounded read-only projections from Tenants and Subscriptions; its Timeline reads selected durable source facts and explicit CRM link audit rows. Inventory movement/balance and count semantics are in [INVENTORY.md](INVENTORY.md); discount pricing and order snapshots are in [DISCOUNTS.md](DISCOUNTS.md); analytics definitions and extension points are in [ANALYTICS.md](ANALYTICS.md); Platform CRM boundaries and current scope are in [docs/crm/README.md](crm/README.md); Tenant CRM is described at [docs/tenant-crm/README.md](tenant-crm/README.md).

Support Ticketing provides tenant/platform APIs, RBAC, PostgreSQL persistence, and locked lifecycle transitions. Phase 2 adds the Tenant Admin list/create/conversation UI; Phase 3 adds the permission-filtered Platform queue, detail, reply, and audited management actions; Phase 4 adds private attachments; Phase 5 queues SMS through the encrypted notification outbox. Tenant scope comes from authenticated host context, Platform permissions are server-enforced, and no plan feature is involved. Inactivity auto-close scheduling remains deferred. See [TICKETING.md](TICKETING.md).

Platform CRM uses the existing modular monolith, PostgreSQL migration path, platform RBAC, audit records, and Next.js App Router. Lead status, Deal stage, work records, custom-field definitions/options, Tags, saved views, Segments, and Workflow runtime state use relational tables; four record tables hold validated custom values in JSONB. CRM list filters, dynamic Segment membership, and Workflow conditions use a flat typed/whitelisted AST with parameterized values. Phase 9 adds a CRM-specific transactional outbox and bounded API poller with PostgreSQL row/advisory locks; it does not add a general event bus, queue, or worker. Actions call CRM service transaction paths and cannot mutate billing. Subscription context is an owner-module projection requiring `subscriptions.read`; CRM does not reconcile source state. No Sales Engine or campaign system exists.

Analytics imports the exported `InventoryVarianceService` for the Inventory Phase 7 report. That service reads tenant-scoped physical counts, source-validated movements and order recipe snapshots; it checks both effective `inventory` and `analytics` entitlements. Inventory does not depend on Analytics, and report reads do not post stock movements.

Tenant CRM is a separate Tenant Admin bounded context documented at [docs/tenant-crm/README.md](tenant-crm/README.md). Phases 1–2 provide a read-only Client directory and query-composed Customer 360 source projections; Phase 3 adds explicit preferences, Notes, Tags, typed Custom Fields, and manual Reminders; Phase 4 adds current-query Segments and Smart Groups; Phase 5 adds tenant Loyalty, a signed ledger, Rewards, and staff redemptions. Composite foreign keys enforce same-tenant Client/resource/member relations. CRM reads bounded projections without granting full Orders or Reservations access. Orders transactionally writes a small `tenant.order.delivered` record to a separate PostgreSQL outbox; a Tenant CRM API poller awards points independently, so Orders never depends on CRM. Loyalty balance is derived from the signed ledger; redemptions lock the tenant/Client account and commit with the ledger debit. The Timeline reconstructs selected source/current-status, CRM, and Loyalty ledger facts, not complete lifecycle history. Tenant CRM does not reuse Platform CRM records, permissions, filters, or workflow semantics.

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
       -> customer_segments -> customer_segment_memberships
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
- **Order:** feature/settings checks → tenant/client checkout lock → server-side simple and advanced item allocation plus order-promotion eligibility (including customer conditions and tenant-local schedule) → coupon row lock and usage recheck when applicable → transaction/financial snapshots and redemption → outbox. Buy/Get, Bundle, Quantity, and customer eligibility use the same PromotionPricingService path. Promotions depend on Clients and Orders data, not CRM or Analytics.
- **Inventory variance:** authenticated Analytics page → tenant count interval → one grouped movement/count query → paginated signed variance and source drill-down; no operational stock write.
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

Phase 10 CRM Analytics is a read-only Platform CRM capability over existing Lead, Deal, work, Workflow, and linked Subscription sources. It uses bounded parameterized PostgreSQL aggregates; it adds no reporting persistence. Customer lifecycle projections use Subscription lifecycle rules and require `subscriptions.read`. See [docs/crm/ANALYTICS.md](crm/ANALYTICS.md) and [ADR-009](crm/ADR-009-crm-analytics-read-model.md).
