# Integrations and source of truth

Platform CRM stays inside the current UCafe modular monolith and shares PostgreSQL. Integration starts with read-only projections or explicit entity references. CRM must not take over another module's mutation path or duplicate its lifecycle calculation.

## Source-of-truth matrix

| Data | Source of truth | CRM ownership | CRM use |
|---|---|---|---|
| Organization commercial name, city, public website/social handles, archive state | CRM | Own | Create, edit, search, archive, and display. |
| Contact name, business role, contact phone/email | CRM | Own, subject to PII controls | Authoritative sales contact record; separate from platform and tenant identities. |
| Lead source, status, qualification, assignment, conversion reference | CRM | Own | Sales workflow and reporting. Source request remains linked intake evidence. |
| Deal estimated value, stage, outcome, loss reason | CRM | Own as sales estimate/judgment | Pipeline and sales forecast only; never payment or revenue authority. |
| Tenant identity, branch/domain, Tenant lifecycle | Tenants / coffee_shops | No | Optional Organization link; read current status and link to existing platform administration. |
| Plan catalog and feature values | Subscriptions / subscription_plans | No | Read current plan context only. |
| Trial, current Subscription status, dates, grace, entitlement | Subscriptions | No | Read authoritative summary. Never copy dates or calculate effective status in CRM. |
| Invoice/payment intent, gateway status, amount, verified reference | Payments / payment_intents | No | Read selected commercial context; use payment APIs and guards. |
| Successful subscription payment and paid-entitlement period | Subscriptions / subscription_payments and subscription_periods | No | Read history where authorized; never create or reconcile a financial record. |
| Platform operators and roles | Identity / users and RBAC tables | No | Actor and assignee references. CRM permission is granted through platform roles. |
| Tenant Clients, orders, customer segments | Clients / Ordering / Promotions | No | Not CRM contacts or prospects. Cross-link only after a separately justified, privacy-reviewed workflow. |
| Public platform form submission | PlatformOrders / platform_order_requests | No for original payload | Link one CRM Lead to an intake request; do not duplicate or rewrite the submission. |
| System/operator audit | Audit / platform_audit_events | No | Record CRM consequential mutations without PII. It does not replace CRM timeline history. |
| SMS delivery | Notifications / notification_deliveries | No | A future reminder may enqueue a delivery, but delivery status is not CRM activity or domain event. |
| Tenant business analytics | Analytics | No | CRM sales analytics remains platform-scoped and separate. |

## Current and planned module boundaries

| Integration | Owner | Consumer | Direction and allowed mutation | Existing contract |
|---|---|---|---|---|
| Tenant | Tenants | CRM | CRM may read a linked Tenant and store a CRM-side reference. No Tenant provisioning, publish/suspend/archive mutation from CRM. | Existing platform Tenant routes and TenantsService. |
| Subscription / Trial | Subscriptions | CRM | Read summary and authoritative lifecycle. Any future user action delegates to the current guarded subscription operation. | Platform subscription endpoints, Subscription/SubscriptionPeriod models. |
| Payments | Payments and Subscriptions | CRM | Read-only commercial context. CRM cannot mark payment successful, create an invoice, refund, or change entitlement. | payment_intents are invoice snapshots; SubscriptionPayment is the successful ledger. |
| Admin identity / authorization | Identity and Authorization | CRM | Read current permission/actor context and reference active platform users for assignment. No CRM-auth identity. | AccessTokenGuard plus PlatformPermissionGuard and database-backed roles. |
| Consultation intake | PlatformOrders | CRM | One-way origin reference from CRM Lead to request; keep the public submission and current endpoint stable. No current request status-write endpoint exists. | Public order-requests endpoint; protected consultation-requests list/detail. |
| Audit | Audit | CRM | CRM calls PlatformAuditService for consequential changes, with non-sensitive summaries. | Append-only platform_audit_events, protected by audit.read. |
| Notifications | Notifications | CRM | Optional future task reminders use the existing delivery interface if appropriate. Do not write CRM domain events as notification jobs. | Encrypted, deduplicated phone-delivery outbox; API-hosted dispatcher. |
| Analytics | Analytics | CRM | No current dependency. Platform CRM reports aggregate CRM-owned history; tenant reports stay in the tenant Analytics domain. | /admin/analytics is tenant-authenticated and plan-gated. |

When a source module lacks a stable read projection, add a narrow read-only application service or response projection in that owning module. Do not clone subscription effective-status logic, payment verification, or Tenant provisioning inside CRM. Avoid direct cross-module writes.

## Consultation request adoption

The current platform form persists a privacy-protected intake row and sends REQUEST_COUNSELING through the notification outbox. The platform inbox can list requests and decrypt a request's phone only for authorized detail.

When Lead management is implemented, CRM should retain a nullable unique source_request_id to the existing request. Create at most one Lead from an intake submission. Use the request as immutable origin data and CRM Lead as the ongoing sales record. Do not change the public form response or make a second consultation inbox. The existing PlatformOrderStatus values do not map one-to-one to CRM LeadStatus; specifically, CLOSED does not mean WON or LOST.

## Domain relationships and deletion

CRM tables are platform-scoped and do not need a tenant ownership column. A CRM Organization may have a nullable unique FK to coffee_shops for the initial one-to-one business mapping. Use RESTRICT/no cascade semantics so a Tenant archive or deletion never removes CRM history. CRM user references should be nullable on hard identity deletion where historical records must remain; normal User deletion is already soft.

