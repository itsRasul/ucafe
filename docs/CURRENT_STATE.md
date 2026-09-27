# Current state

**Reviewed:** 2026-09-27 (Asia/Tehran)

## Implemented

- Shared multi-tenant PostgreSQL model, hostname resolution, provisioning, platform/tenant RBAC, and separate cafe-client identities.
- Tenant storefront, curated content/theme/media, menu, cart/checkout, offline pickup/courier ordering, reservations, and client panel.
- Owner admin and platform operations panels, including plan controls, renewal invoices/payment intents, consultation requests, and audit history.
- Trial/prepaid/grace/suspension lifecycle, plan feature gates, simulated and Zarinpal payment adapters.
- Development and sms.ir providers plus an encrypted, deduplicated transactional notification outbox.
- Phase 0 tenant analytics foundation: delivered-order overview, timezone-aware periods, previous-period comparison, tenant `analytics.read` permission, and an outcome-time order index. See [ANALYTICS.md](ANALYTICS.md).
- Phase 1 adds configurable Analytics plan entitlement (Golden default), zero-filled revenue/order/AOV trends, and a responsive tenant-admin overview. See [ANALYTICS.md](ANALYTICS.md).
- Phase 2 adds tenant-local hourly and weekday distributions, a weekly and calendar heatmap, and period-specific peaks. See [ANALYTICS.md](ANALYTICS.md).
- Phase 3 adds historical line-based product/category rankings, contribution, growth/decline, zero-sale products, category-at-sale snapshots, and product/category trends. See [ANALYTICS.md](ANALYTICS.md).
- Inventory Phase 1 adds tenant-scoped item/category/location management, transactional opening balances and adjustments, stock/count/history views, and the configurable feature gate. See [INVENTORY.md](INVENTORY.md) and [PROGRESS.md](PROGRESS.md).
- PostgreSQL/Redis/MinIO readiness, security headers, request IDs, backup/restore scripts, Docker development/production targets.

## Platform CRM Phases 2–9

- Phases 0–9 are complete. CRM includes Organizations, Contacts, Leads, Deals/Pipeline, Activities, Tasks/follow-ups, Notes, status/stage history, assignment, audit, a query-time Unified Timeline, Organization 360, explicit Tenant linking, read-only Tenant/Trial/Subscription context, typed custom fields, CRM-wide Tags, saved views, dynamic Segments, Lead scoring, and Workflow automation; see [docs/crm/README.md](crm/README.md), [AUTOMATION.md](crm/AUTOMATION.md), [API.md](crm/API.md), and [PROGRESS.md](PROGRESS.md).
- A CRM Organization may link to one existing Tenant, and each Tenant to at most one Organization. This does not backfill existing Tenants or change their lifecycle.
- Accepted public consultation requests create a linked `LANDING_FORM` Lead in the same transaction; existing requests are not backfilled and the public/request inbox contracts are unchanged.
- Lead conversion itself creates no Deal. Phase 4 Activities, Tasks, and Notes use explicit CRM associations and transactional audit writes. Phases 5–6 compose CRM records and selected durable customer facts at read time. Phase 7 stores typed values and query definitions, not static Segment membership. Phase 9 adds a separate CRM Workflow outbox/runtime; no Timeline table, Sales Engine, campaigns, general domain-event bus, billing actions, or fabricated Tenant/Subscription lifecycle transitions were added.

## Platform CRM Phase 7

- Added typed custom fields for Organizations, Contacts, Leads, and Deals; CRM-wide Tags; owner-scoped PRIVATE and SHARED saved views; and dynamic Segments with server-side preview/count/paged records. Filter criteria use a bounded flat AND/OR AST and whitelisted parameterized SQL; no full-list browser filtering.
- Custom field option IDs remain stable when labels change. Values and Tag assignments persist across archive; inactive definitions/options are excluded from new edits and filters. Record detail pages expose metadata editors with the same `crm.manage` permission as existing CRM mutations.
- Migration `1790560000000-PlatformCrmFieldsTagsViewsSegments` adds four JSONB `custom_fields` objects plus relational definitions, options, tags/assignments, saved views, and segments. Promotion customer segments and Plan feature definitions remain separate systems.

## Platform CRM Phase 3

- Implemented Deals with the single code-defined `ucafe-default` pipeline, six ordered stages, append-only stage history, explicit WON/LOST outcomes, loss reasons, owner, expected Plan reference, Toman estimate, expected close date, archive/restore, filtering and stage totals.
- Deals link to an Organization, optional same-Organization Contact, and optionally one qualified or converted Lead already linked to that Organization (unique originating Deal). Stage writes use row locks, expected-stage concurrency checks, transactions, and PII-free audit. CRM stage/outcome never mutates subscriptions/payments.
- The platform CRM UI includes the deal list/detail/create/edit flows and the responsive pipeline board. See Phase 4 below; there is no general event bus.

## Platform CRM Phase 4

- Implemented Activity, Task, and Note records with explicit same-Organization foreign keys, Lead-only associations before conversion, active record validation, and transactional PII-safe audit.
- Activities represent past interactions, Tasks represent future work (including `FOLLOW_UP`), and Notes hold plain-text context. Task overdue state is derived; task completion does not create an Activity. No reminder delivery or unified timeline is included.
- CRM Organization, Contact, Lead, and Deal details include separate work sections. Contacts have a detail route, and `/platform/crm/tasks` provides a task queue. Migration `1790540000000-CreatePlatformCrmWorkRecords` is applied to the development database.

## Platform CRM Phase 5

- Organization detail now composes a bounded overview with derived active Contact, linked Lead, active Deal, open Deal, and open Task counts; last Activity; next Task; and recent Lead/Deal/Task/Activity/Note previews. The existing Contact directory remains paginated and authoritative.
- The Organization Timeline is a filtered, paginated query-time `UNION ALL` across Lead/Deal creation and history, Deal outcomes, Activities, Tasks, selected Task lifecycle audit actions, and Notes. It preserves pre-conversion Lead history, deduplicates multi-linked source records, and includes archived historical sources. No Timeline table or migration was added.
- New read routes are `GET /api/v1/platform/crm/organizations/:organizationId/overview`, `/timeline`, and `/customer-context`. Context and Timeline require `crm.read` plus `subscriptions.read`; explicit Tenant link/unlink requires `crm.manage` plus `tenants.read`. Timeline uses only Tenant creation/link facts, Trial start, and successful paid Subscription operations. CRM analytics remains deferred.

## Production blockers

- Successful real sms.ir acceptance for every configured template ID.
- Successful low-value Zarinpal request, redirect, callback, verification, and reconciliation acceptance with a real merchant.
- Final hosting topology, wildcard DNS/TLS, reverse-proxy header stripping/trust, secret management, monitoring/on-call destinations, backup retention, and vulnerability review.

The software is not production-ready until [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) is complete.

## Known technical debt

- Notifications are dispatched by an in-process five-second API timer. Conditional row claims prevent duplicate sends, but multiple API replicas duplicate scans/scheduled sweeps and have no dedicated worker coordination.
- The worker workspace is only a bootstrap scaffold; media processing and notification scheduling still run in the API.
- Redis is required and probed by readiness but is not currently used for OTP throttling or application caching.
- Image processing is synchronous; object-store failures can leave orphan variants without automated reconciliation.
- Reservation/business API errors are primarily English while the user interface is Persian.
- Reservation/opening-hour logic supports same-day ranges only.
- `compose.prod.yaml` publishes API and PostgreSQL loopback ports; a real deployment must deliberately restrict/reroute them.
- `.env.example` omits `API_INTERNAL_URL`, although Compose requires it for web-to-API SSR/proxy calls.
- The environment key `SUBSCRIPTION_FAILD_PAID` contains a compatibility typo and must be configured exactly as implemented until a migration strategy renames it.
- `README.md` still routes readers to removed phase/progress documents and must be updated in a separately authorized change.

## Immediate next work

1. Complete provider and hosting acceptance without adding unrelated product scope.
2. Define any further Tenant status or Subscription lifecycle history in the owning modules before adding corresponding CRM Timeline facts.
3. Move the dispatcher to a coordinated worker before horizontal API scaling.
