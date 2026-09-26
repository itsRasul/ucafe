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
