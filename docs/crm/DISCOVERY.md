# Existing-system discovery

This report records current implementation findings. Proposed CRM behavior is kept separate in the other documents in this directory.

## Current implementation

| Area | Current source and ownership |
|---|---|
| Tenant | The Tenant root is coffee_shops. It has status, locale/timezone, publish/suspend/archive/delete timestamps. Provisioning in TenantsService creates a draft shop, primary Branch, active platform subdomain, website settings, reservation settings, and optional owner membership in one transaction. See [coffee-shop.entity.ts](../../apps/api/src/database/entities/coffee-shop.entity.ts), [tenants.service.ts](../../apps/api/src/tenants/tenants.service.ts), and [platform-tenants.controller.ts](../../apps/api/src/tenants/platform-tenants.controller.ts). |
| Tenant structure | A coffee_shop has Branch rows and Domains; the current provisioning flow creates one primary branch and one primary platform subdomain. Branches and domains have soft-delete timestamps. Multi-branch storefront and custom-domain onboarding are not currently complete product flows. |
| Administrative identity | users are platform operators and tenant owner/staff identities. Platform roles are assigned through user_platform_roles; tenant roles through a membership. Platform and tenant guards are separate. See [AUTHENTICATION.md](../AUTHENTICATION.md) and [AUTHORIZATION.md](../AUTHORIZATION.md). |
| Tenant customers | clients are cafe-scoped customer identities, unique by tenant and phone. They have client sessions, addresses, orders, reservations, and manual customer segments. Their phone is operational tenant data. They are not platform CRM contacts. |
| Consultation intake | The public platform form posts to POST /api/v1/public/platform/order-requests. It stores contact name, café name, normalized phone encrypted at rest plus a blind hash, city, business stage, requested services, optional note, source, and a status initially NEW. The public response omits phone; the form also has a honeypot and a 15-minute repeat-phone limit. Source: [PlatformOrderRequest](../../apps/api/src/platform-orders/entities/platform-order-request.entity.ts), [PlatformOrdersService](../../apps/api/src/platform-orders/platform-orders.service.ts), and [CreatePlatformOrderRequests migration](../../apps/api/src/database/migrations/1787785200000-CreatePlatformOrderRequests.ts). |
| Consultation admin surface | GET /api/v1/platform/consultation-requests and /:id are protected by consultation_requests.read. List responses omit phone; detail decrypts it. Current persisted statuses are NEW, CONTACTED, QUALIFIED, and CLOSED, but the API has no status mutation. The request is therefore a read-only intake inbox today, not a functioning pipeline. The source component is [platform-orders.controller.ts](../../apps/api/src/platform-orders/platform-orders.controller.ts). |
| Subscriptions and payments | There is one Subscription per Tenant, with Trial and paid/grace/suspended state. SubscriptionPeriod is entitlement history; SubscriptionPayment is the successful payment ledger. payment_intents are the owner/platform-facing invoice snapshots; there is no separate invoice ledger. See [SUBSCRIPTIONS.md](../SUBSCRIPTIONS.md) and [PAYMENTS.md](../PAYMENTS.md). |
| Events, jobs, audit | There is no general domain-event bus or message broker. notification_deliveries is an encrypted SMS delivery outbox with typed notification kinds, recipient ciphertext, delivery retries, and deduplication; it is not a CRM event store. The API dispatches it on an in-process timer. platform_audit_events records selected operator actions, not every domain transition or a unified timeline. |
| Analytics | The current Analytics module and /admin/analytics pages are tenant-facing and report cafe operations. They are not a platform sales analytics service. See [ANALYTICS.md](../ANALYTICS.md). |
| Platform UI | /platform currently renders one client component with state-selected views for dashboard, tenants, consultation requests, invoices, users, roles, permissions, plans, and audit. Permission-aware navigation, split list/detail views, local forms/tables, status badges, feedback states, and responsive Persian RTL CSS exist. The platform imports the tenant admin CSS and reuses BrandLogo and SiteSettingsEditor; there is no shared component library or CRM route. See [platform-admin.tsx](../../apps/web/src/app/platform/platform-admin.tsx) and [platform.css](../../apps/web/src/app/platform/platform.css). |

## Established CRM architecture

- Platform CRM is implemented through Phase 4 as a platform-only domain in the existing NestJS/TypeORM API and Next.js app.
- Keep CRM Organizations and Contacts distinct from existing Tenants, Users, and Clients.
- Keep public consultation submissions in platform_order_requests as intake history. Each accepted request creates one linked CRM Lead; the Lead is the sales-work record.
- Keep CRM-owned lifecycles and history in CRM. Read Tenant, Subscription, Plan, Trial, and payment context through their existing ownership boundaries.
- Use the existing platform permission guard, DTO validation, TypeORM migration discipline, and same-origin web API proxy.
- Activities, Tasks, and Notes use explicit same-Organization foreign keys; Lead-only work is allowed before conversion and resolved through the Lead after conversion.
- Follow-up is a Task kind. Task overdue state is derived. CRM work mutations write selected audit records transactionally; notification deliveries are not CRM events.
- Build no Sales Engine or general event publisher/broker. The CRM domain does not reuse Tenant Clients, background jobs, or notification delivery rows as work records.

## Documentation map

There is no current `docs/PROJECT_SPEC.md` or `docs/PLAN.md`. Decision D-049 records their removal; current product intent is in [PRD.md](../PRD.md), architecture in [ARCHITECTURE.md](../ARCHITECTURE.md), implementation progress in [PROGRESS.md](../PROGRESS.md), and historical rationale in [DECISIONS.md](../DECISIONS.md). CRM decisions therefore follow the repository's central decision log rather than creating a second ADR folder.

## Compatibility and conflict analysis

| Existing behavior | Potential CRM conflict | Decision | Reason |
|---|---|---|---|
| coffee_shops is the Tenant root and owns operational state, branches, domains, and platform hosting. | A CRM Organization may look like another café/Tenant row. | Keep Organization as the prospect/business relationship record and Tenant as the provisioned operational account; link them optionally one-to-one at first. | Businesses can be tracked before provisioning, and a Tenant can have multiple branches. Do not mirror Tenant status or lifecycle. |
| users identifies admins/owners/staff; clients identifies customers within a Tenant. | CRM Contact could be incorrectly attached to either identity domain. | Keep Contact independent. Do not auto-merge on matching phone/email. Add an explicit identity link only if a later workflow proves it necessary. | A sales contact may never log in, and one person may hold different operational/customer identities. |
| platform_order_requests already stores a café, contact, phone, source, and a partial status vocabulary. | A new CRM lead intake table would duplicate every public form submission; mapping status directly would lose distinctions. | Keep the request as intake; link at most one CRM Lead to its request. CRM Lead owns sales status. Do not map CLOSED to WON or LOST. | Intake facts and sales work have different lifecycles. Preserve current public and admin APIs. |
| Tenant Subscription, Trial, payment intents, and SubscriptionPayment already have lifecycle/financial authority. | Deal value or status could be misrepresented as billing state. | CRM Deal is a sales forecast/opportunity only. It cannot settle payment, provision a Tenant, or change a Subscription. | Existing modules own these rules and financial records. |
| consultation_requests.read is a fixed platform permission; roles are database-backed and scope-checked. | CRM visibility could be granted by role name or route hiding. | Add future CRM keys to the fixed PLATFORM permission catalog and enforce them with PlatformPermissionGuard on each API method. | This follows current authorization and custom-role behavior. |
| REQUEST_COUNSELING is an SMS notification kind; platform_audit_events is an operator audit table. | Either could be mistaken for a domain-event bus or CRM timeline. | Keep delivery, system audit, and CRM history separate. | Existing schemas do not guarantee complete domain history or event delivery. |
| /platform uses an internal view state and has ten navigation entries. | Adding every CRM list as another top-level/mobile item will crowd current navigation and grow the monolithic component. | Add a single CRM entry and place its pages under a CRM workspace with URL-backed App Router routes when UI work begins. | This preserves existing platform context while supporting deep links and browser navigation. |

## Risks and open product questions

- UCafe has no validated sales playbook or Sales Engine. The proposed Lead statuses and pipeline are defaults for Phase 2/3, not discovered current operations.
- The initial Organization-to-Tenant one-to-one link matches the current tenant/branch model. Revisit only if one managed business is intentionally split across independently provisioned Tenants.
- CRM contact PII needs purpose-limited access and retention rules before implementation. Existing platform intake encryption is a useful pattern, not an automatic complete CRM policy.

## Phase 2 implementation discoveries and resolutions

- Phase 1 persists Organization and Contact records in `CrmService`; it does not provide an existing Lead or prospect model. Phase 2 therefore adds CRM-owned Lead and LeadStatusHistory tables rather than converting or replacing `platform_order_requests`.
- Public request creation is owned by `PlatformOrdersService`. It now creates a one-to-one LANDING_FORM Lead using the same transaction manager as the request and the existing REQUEST_COUNSELING enqueue. The public response, phone repeat limit, honeypot, and inbox remain unchanged. Historical requests are not backfilled.
- Phase 0 `LIFECYCLE.md` had described conversion as creating a Deal, but the Phase 2 task explicitly defers Deals. D-077 updates the implemented contract: conversion requires a qualified Lead, resolves/creates Organization and Contact atomically, and records CONVERTED without a Deal. Phase 3 adds Deals against those records.
- CRM phone/email normalization and encrypted keyed-hash storage reuse `AuthCryptoService` and the Phase 1 CRM normalization utilities. Potential duplicates are exact signals and require an explicit link or confirmation; the system never auto-merges.
- CRM remains a modular-monolith domain. The implementation uses status history and the existing operator audit table; it introduces no domain-event framework, broker, Sales Engine, or CRM-wide timeline.

## Phase 4 implementation discoveries and resolutions

- Project-wide search found no existing CRM Activity, Task, Todo, Reminder, Follow-up, or Note model, no scheduled reminder mechanism suitable for sales work, and no reusable CRM work UI. The notification outbox is for SMS delivery and is not used to model CRM Tasks or publish CRM events.
- Lead and Deal assignment patterns already validate active platform Users with CRM access. Phase 4 reuses the Lead assignee validation instead of adding CRM-specific identity or role logic.
- Existing CRM `platform_audit_events` writes selected operator actions but are not a complete event stream. Phase 4 records transactional audit actions with content-free summaries; a durable integration event contract remains future scope.
- The Phase 4 work model uses explicit relation columns and composite foreign keys rather than a polymorphic owner pair. This gives PostgreSQL same-Organization integrity and lets pre-conversion Lead-only work remain valid without an invented Organization.

## Phase 6 discovery — Tenant, Trial, and Subscription integration

Findings below were checked against the current entities, services, controllers, migrations, and platform UI before changing CRM runtime code.

### Tenant and existing CRM link

- `coffee_shops` is the Tenant root, keyed by UUID. The existing Tenant model owns status (`DRAFT`, `PREVIEW`, `ACTIVE`, `SUSPENDED`, `ARCHIVED`), locale/timezone, `published_at`, `suspended_at`, `archived_at`, `deleted_at`, branches, and domains. One Tenant may contain multiple branches; provisioning currently creates one primary branch and one primary platform subdomain.
- `TenantsService.provision` is the platform-only creation path. It transactionally creates a DRAFT coffee shop, primary branch, active subdomain, site/reservation settings, and optionally an owner membership. Signup, CRM Deal closure, and Subscription purchase do not create a Tenant. No Platform API currently implements tenant archive/delete or manual status transitions; the model has archive/soft-delete fields, and hard deletion is constrained by references.
- Subscription reconciliation maps TRIALING to PREVIEW, ACTIVE/GRACE to ACTIVE, and SUSPENDED/CANCELED to SUSPENDED. Tenant suspension therefore may be changed by Subscription lifecycle work; CRM cannot infer or write this lifecycle.
- There is no Tenant status-history table or general event publisher. `tenant.provisioned` is an operator audit action written after the provisioning transaction; it is not complete Tenant lifecycle history. The Tenant detail API exposes branch and membership status, but there is no reliable owner display name. CRM should not expose owner phone as a substitute.
- Phase 1 already added the optional one-to-one relationship as `crm_organizations.coffee_shop_id`, backed by a partial unique index and `ON DELETE RESTRICT`. There is no second link entity or backfill. The existing selector uses explicit Tenant IDs and excludes soft-deleted Tenants. Organization create/update currently accepts the link as a general profile field and writes only a generic `crm.organization.updated` audit action; it does not retain link/unlink history.
- Existing Tenants remain unlinked until an operator chooses the exact Tenant. No safe deterministic identifier relationship exists for automatic backfill. Name, city, slug, phone, or domain similarity cannot establish canonical linkage.

### Subscription, Trial, Plan, and payment

- There is at most one `subscriptions` row per Tenant. It points to one current `subscription_plans` row and optionally a pending Plan. The current Plan catalog is editable; Plan names, prices, trial/grace lengths, and feature values are data, not constants.
- Trial is not a separate entity: `trial_started_at` and `trial_ends_at` live on Subscription. Starting a Trial is an explicit `subscriptions.manage` Platform action, and a second Subscription/Trial for the same Tenant is rejected. Trial expiry becomes SUSPENDED immediately without paid grace.
- Subscription stores status, current-period dates, `paid_through_at`, `grace_ends_at`, suspension/cancellation dates, pending Plan and effective date, and version. `effectiveSubscriptionStatus` owns the time-based status rules. Summary reads may reconcile and mutate Subscription/Tenant state, so CRM needs a non-mutating owner-module projection using that existing rule rather than calling the reconciliation path.
- `subscription_periods` preserves paid entitlement ranges; `subscription_payments` is the successful payment ledger with operation, Plan/period snapshots, and `paid_at`. Upgrades can rewrite remaining period Plan IDs, so periods are not a complete Plan-change history. `payment_intents` are immutable invoice/checkout snapshots; there is no separate invoice ledger. CRM does not need amount, provider reference, authority, pricing JSON, gateway state, or payment mutation.
- There is no Subscription status-history table or published lifecycle event stream. `platform_audit_events` contains selected actions (`subscription.trial_started`, `subscription.payment_recorded`, `subscription.reconciled`), but they are not a complete, transactional record of every automatic transition. Durable Timeline coverage can use Tenant `created_at`, Subscription `trial_started_at`, successful non-legacy SubscriptionPayment operations, and new transactional CRM link audit records. It cannot truthfully show historic Tenant status changes, Trial expiry, Subscription grace/suspension/expiry/cancellation, or every scheduled Plan change.
- Platform Subscription APIs currently use the single `subscriptions.manage` permission for both viewing a broad response (which includes payment context) and mutation. CRM needs a narrow `subscriptions.read` permission and a summary that omits financial/provider fields; existing mutation endpoints remain guarded by `subscriptions.manage`.

### Integration decisions for implementation

- Keep the existing nullable one-to-one Tenant FK and unique database constraint. Make link/unlink explicit, protect it with `crm.manage` plus `tenants.read`, and write link/unlink audit rows in the same transaction so relationship history is factual. Unlink clears only the CRM FK; it never deletes or changes Tenant state.
- Keep prospect Organizations and Won Deals valid without a Tenant. CRM will not provision Tenants or create Subscriptions from Deal changes; it will navigate to the existing Platform provisioning/administration views.
- Compose a bounded Customer Context from a small TenantsService projection and a non-mutating SubscriptionsService read projection. CRM persists no Tenant, Trial, Plan, Subscription, period, or payment state. Expected Deal Plan remains distinct from the actual Plan.
- Extend the existing paginated Timeline with only durable Tenant creation, explicit CRM link/unlink, Trial start, and supported paid Subscription operation records. Continue the existing single query-time UNION/pagination path; do not use the incomplete audit stream to invent lifecycle history.

### Phase 6 implementation outcome

- Migration `1790550000000-CrmCustomerContext` adds platform `subscriptions.read` and grants it to roles that already have `crm.read` or `subscriptions.manage`. CRM customer context and the mixed-source Timeline require both `crm.read` and `subscriptions.read`; link candidates require `crm.read` plus `tenants.read`, while link/unlink require `crm.manage` plus `tenants.read`.
- Organization create/edit no longer accepts `coffeeShopId`. Dedicated POST/DELETE link operations lock and validate source rows, preserve the existing unique FK, and write the Tenant UUID audit summary transactionally. Unlink clears only the CRM relationship.
- `GET .../customer-context` composes Tenant and Subscription owner-module projections. The Subscription read uses `effectiveSubscriptionStatus` without reconciliation and omits payment/provider/member PII. The 360 page now separates this actual context from expected Deal Plan and links to existing Tenant administration.
- The Timeline remains one bounded read-time union. It includes only Tenant creation, audited CRM link/unlink, Trial start, and successful non-legacy paid Subscription operations. No Tenant status-history or automatic Subscription lifecycle facts are invented.
- PostgreSQL tests exercise link uniqueness/audit history, active Trial and converted Subscription projections, read non-mutation, and payment Timeline privacy. No tenant or subscription schema changes were required.
