# Integrations and source of truth

Platform CRM stays inside the current UCafe modular monolith and shares PostgreSQL. Integration starts with read-only projections or explicit entity references. CRM must not take over another module's mutation path or duplicate its lifecycle calculation.

## Source-of-truth matrix

| Data | Source of truth | CRM ownership | CRM use |
|---|---|---|---|
| Organization commercial name, city, public website/social handles, archive state | CRM | Own | Create, edit, search, archive, and display. |
| Contact name, business role, contact phone/email | CRM | Own, subject to PII controls | Authoritative sales contact record; separate from platform and tenant identities. |
| Lead source, status, qualification, assignment, Organization/Contact links, conversion timestamp | CRM | Own | Sales workflow and reporting. Conversion resolves Organization and Contact; Deal remains Phase 3. Source request remains linked intake evidence. |
| Deal estimated value, expected close date, stage, outcome, loss reason | CRM | Own as sales estimate/judgment | Pipeline board and operational forecast only; never payment or revenue authority. |
| Activity, Task, and Note content and lifecycle | CRM | Own | Manually recorded past interactions, future work/follow-ups, and plain-text internal context. No external channel sync or reminders. |
| Custom field definitions, typed record values, Tags, saved views, and Segments | CRM | Own | Phase 7 metadata for Organizations, Contacts, Leads, and Deals. Segments are dynamic CRM query definitions, not client/customer segments or campaign audiences. |
| Lead scoring rules, current scores, and score history | CRM | Own | Phase 8 evaluates bounded Lead fields, Lead custom fields/Tags, and Activity-derived signals. Phase 9 publishes a score-change trigger inside the source transaction. It changes no Lead lifecycle, manual Priority, Deal, Task, or customer context. |
| Workflow definitions, trigger events, executions, and action results | CRM | Own | Phase 9 validates bounded trigger/condition/action configuration and processes a durable CRM-specific outbox. Actions reuse CRM transactional service methods. |
| Unified Timeline | CRM read model over CRM histories/work and selected durable customer facts | No | Query-time Organization-scoped view; reads Tenant creation, link/unlink audit, Trial start, and successful paid Subscription operation facts. |
| Organization 360 summary and previews | CRM read model over Organization, Contact, Lead, Deal, Activity, Task, and Note | No | Bounded composed overview; customer panel separately composes owner-module projections. Contact pages remain the source for paginated Contact detail. |
| Tenant identity, branch/domain, Tenant lifecycle | Tenants / coffee_shops | No | Optional explicit Organization link; read current Tenant identity/status/durable dates and navigate to platform Tenant administration. |
| Plan catalog and feature values | Subscriptions / subscription_plans | No | Read current and scheduled Plan names only; feature configuration is not copied. |
| Trial, current Subscription status, dates, grace, entitlement | Subscriptions | No | Use the non-mutating customer-context projection; never reconcile, copy dates, or calculate status in CRM. |
| Invoice/payment intent, gateway status, amount, verified reference | Payments / payment_intents | No | No Phase 6 CRM display; those records stay in their existing guarded APIs. |
| Successful subscription payment and paid-entitlement period | Subscriptions / subscription_payments and subscription_periods | No | Timeline uses only paid operation/plan snapshot/period end; never expose amounts/provider refs or create/reconcile financial records. |
| Platform operators and roles | Identity / users and RBAC tables | No | Actor and assignee references. CRM permission is granted through platform roles. |
| Tenant Clients, orders, customer segments | Clients / Ordering / Promotions | No | Not CRM contacts or prospects. Promotion customer segments remain tenant-scoped and independent from Phase 7 CRM Segments. Cross-link only after a separately justified, privacy-reviewed workflow. |
| Public platform form submission | PlatformOrders / platform_order_requests | No for original payload | Each accepted consultation request creates one CRM Lead in the same transaction, linked by unique source_request_id. The request remains immutable intake evidence. |
| System/operator audit | Audit / platform_audit_events | No | General audit remains selective and is not a Timeline feed. Timeline reads Task completed/canceled/reopened actions for lifecycle timestamps/actors and the matching Deal win/loss action for actor only; source Task/Deal rows supply the current record context and Deal outcome time. |
| SMS delivery | Notifications / notification_deliveries | No | Phase 4 does not send Task reminders. Delivery status is not CRM activity or domain event. |
| Tenant business analytics | Analytics | No | CRM sales analytics remains platform-scoped and separate. |

## Current and planned module boundaries

| Integration | Owner | Consumer | Direction and allowed mutation | Existing contract |
|---|---|---|---|---|
| Tenant | Tenants | CRM | CRM reads linked Tenant context, stores only the unique reference, and links/unlinks that association explicitly. No Tenant provisioning or lifecycle mutation. | `TenantsService.getCrmContext`, candidate query, existing platform Tenant routes. |
| Subscription / Trial | Subscriptions | CRM | CRM reads a narrow, non-mutating projection of effective status, current/scheduled Plan names, Trial dates/status, current period, and grace. | `SubscriptionsService.getCrmContext`; do not call `getTenantSummary` because it may reconcile. |
| Payments | Payments and Subscriptions | CRM | No invoice/payment detail panel. Timeline reads only successful non-legacy SubscriptionPayment operations and period end, with no amounts or provider references. CRM cannot mark payment successful, create an invoice, refund, or change entitlement. | `subscription_payments` is the successful ledger; `payment_intents` are invoice snapshots. |
| Admin identity / authorization | Identity and Authorization | CRM | Read current permission/actor context and reference active platform users for assignment. No CRM-auth identity. | AccessTokenGuard plus PlatformPermissionGuard and database-backed roles. |
| Consultation intake | PlatformOrders | CRM | On accepted submission, create a landing-form Lead and one-way origin reference. Keep the public submission and current endpoint stable. Request status is not mapped to Lead status. | Public order-requests endpoint; protected consultation-requests list/detail; additive CRM synchronization in PlatformOrdersService. |
| Deal expected Plan | Subscriptions / `subscription_plans` | CRM | Store an optional restrictive reference and read the current plan name; no price snapshot, selection, subscription, trial, invoice, or payment mutation. | Read-only `deal-plans` projection; existing Plan remains authoritative. |
| Audit | Audit | CRM | CRM writes consequential operator changes, including Tenant link/unlink, to platform_audit_events with non-sensitive summaries. | Append-only platform_audit_events; link association IDs are used only to retain factual Timeline history. Protected for operator audit view by audit.read. |
| Notifications | Notifications | CRM | Workflow actions do not send SMS/email/WhatsApp or write notification deliveries. | Encrypted, deduplicated phone-delivery outbox; API-hosted dispatcher. |
| Analytics | Analytics | CRM | Phase 5 exposes operational Organization counts; Phase 7 adds live query-based Segments; Phase 8 retains current scoring snapshots and change history for later reporting. No CRM analytics report is implemented. Tenant reports stay in the tenant Analytics domain. | /admin/analytics is tenant-authenticated and plan-gated. |

When a source module lacks a stable read projection, add a narrow read-only application service or response projection in that owning module. Do not clone subscription effective-status logic, payment verification, or Tenant provisioning inside CRM. Avoid direct cross-module writes.

Phase 7 filters the direct Organization-to-Tenant association (`tenantLinked`). It does not filter on effective Subscription status, Trial state, or current Plan yet: those are computed by the Subscriptions owner projection, including time and pending-plan rules. Add those filters only when the owner module exposes a query projection that keeps list and Segment counts authoritative without copying or reimplementing its lifecycle.

Phase 8 score sources are limited to registered Lead columns, Lead custom fields and Tags, plus the existing Activity table through bounded count/latest/demo/connected-call expressions. A directly Lead-linked Activity counts for that Lead; an Organization-level Activity counts only for unconverted Leads linked to the same Organization. Contact, Task, Deal, Organization attributes, Tenant/Trial/Subscription context, Notes, and free text are excluded. Add a new source only with a query-safe field definition and complete recalculation invalidation path.

## Phase 9 event/runtime integration

CRM domain writes emit only selected triggers into `crm_workflow_events` within the same source transaction. The API process polls this CRM outbox with `FOR UPDATE SKIP LOCKED`, bounded batches, and stale-claim recovery. Trial-ending and overdue Task sweeps run under a PostgreSQL advisory lock and use authoritative source dates. This is not the encrypted notification outbox and does not reuse its SMS dispatcher; it is not a generic domain event bus or Worker/BullMQ queue. Actions use Lead/Deal owner assignment helpers, Tag mutation, or `CrmTaskService.createIn` inside the action transaction.

The scanner may read active `TRIALING` subscription facts through the existing CRM Organization-to-Tenant link. It creates an `TRIAL_ENDING` CRM event only; it never edits Subscription/Trial/Tenant state. No Subscription activated/renewed/expired event is supported because the source has no complete durable publisher contract. CRM Organizations have no owner field, so Trial Tasks must be unassigned or assigned to a selected active CRM user. See [AUTOMATION.md](AUTOMATION.md) and [EVENTS.md](EVENTS.md).

## Consultation request adoption

The public form persists a privacy-protected request and sends REQUEST_COUNSELING through the notification outbox. The platform inbox can list requests and decrypt a request's phone only for authorized detail. Phase 2 adds Lead creation to the same `manager.transaction` as the request and notification enqueue. `crm_leads.source_request_id` is unique and has `ON DELETE RESTRICT`; `createFromRequest` is idempotent if called again for the same request. A failed Lead creation rolls back the request and notification enqueue, so the public endpoint returns an error rather than accepting an intake that has no CRM Lead.

The new Lead is `LANDING_FORM`/`NEW`, unassigned, and stores a normalized/encrypted contact snapshot; the original stage and requested-services values remain in the source request and are shown in the Lead detail projection. No note or public-request fields are copied into CRM. The public success response, repeat-phone limit, honeypot, request inbox, and REQUEST_COUNSELING payload remain unchanged. Existing requests are not backfilled. `PlatformOrderStatus` values remain independent from `CrmLeadStatus`; in particular, CLOSED does not mean WON or LOST.

## Domain relationships and deletion

CRM tables are platform-scoped and do not need a tenant ownership column. A CRM Organization may have a nullable unique FK to coffee_shops for the initial one-to-one business mapping. Use RESTRICT/no cascade semantics so a Tenant archive or deletion never removes CRM history. CRM user references should be nullable on hard identity deletion where historical records must remain; normal User deletion is already soft.
