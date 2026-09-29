# Tenant CRM

**Status:** Phases 0–6 implemented in code. Phase 6 focused tests pass 10/10 with PostgreSQL enabled; the full API suite passes (196 passed, 33 skipped), root typecheck and production build pass, and migration `1790640000000-TenantCrmFeedback` is applied. Authenticated browser acceptance remains pending until tenant-admin and customer sessions are available; details are in [PROGRESS.md](../PROGRESS.md).

## Purpose and boundary

Tenant CRM is the tenant-admin capability for a café to manage its relationship with its own customers. Its operators are tenant Users; its customer identity is the existing tenant-owned Client. A Client is never a User, and a person with the same phone at two cafés has separate Client records and separate histories.

This domain is separate from Platform CRM, which manages UCafe's commercial relationship with café businesses. No Platform CRM record may link to a Tenant CRM customer or its data.

## Implemented in Phase 1

- Keep Client as customer identity and source of truth; no duplicate Customer or CRM profile table was added.
- Keep Orders, Reservations, Discounts, and Tenant Analytics authoritative in their existing modules.
- Resolve tenant scope from the trusted tenant context. Every API request requires `tenant_crm.read` and effective `tenant_crm` entitlement.
- The read-only directory lives at `/admin/crm`; its list and detail APIs live at `/tenant/crm/clients`.
- Golden defaults to the feature; other plans default off. Platform Admin can change any plan with the existing plan editor. Promotions keeps its current access rules.
- Search supports names and normalized exact Iranian mobile numbers; list phone values are masked and authorized detail shows full phone.
- Reuse only domain-neutral primitives. Do not reuse Platform CRM domain records, platform permissions, filter compiler, workflow, or analytics semantics.

## Implemented in Phase 2

- Extend the existing Client detail page with bounded Customer 360 summaries, the five most recent Orders and Reservations, and a keyset-paginated unified Timeline.
- Client, Orders, and Reservations remain authoritative. Customer 360 is a query-time read composition, not a Customer/Profile entity or copied history.
- “Known UCafe Spend” sums `orders.total_amount_toman` only for current `DELIVERED` Orders. That stored value is the final offline payable order amount after recorded discounts; it does not prove collection and omits off-platform purchases. CRM does not change Order financial semantics.
- `lastInteractionAt` is the latest Order/Reservation creation or currently retained latest status transition timestamp; it falls back to `Client.createdAt`, never administrative `Client.updatedAt`.
- Timeline is reconstructed from source rows, not an immutable event log. Order/Reservation rows retain only current status and latest `status_changed_at`, so earlier transitions cannot be recovered or displayed.
- `tenant_crm.read` permits this deliberately limited CRM projection without granting `orders.read` or `reservations.read`. CRM returns only fields needed for the customer view; source-module access remains separately protected.
- Tenant + Client scope is included in every source branch/query. Timeline uses globally unique event keys and strict descending `(occurredAt,eventKey)` keyset pagination.
- No new table, migration, or index was justified by `EXPLAIN (ANALYZE, BUFFERS)` on the exact queries at current development fixture volume; revisit with representative production volume.

## Implemented in Phase 3

- Add café-entered preferences, internal Notes, tenant-owned Tags, typed Custom Fields, and manual Reminders around the existing Client identity.
- Integrate all five into Customer 360. Tags and Custom Fields are managed in `/admin/crm/fields`; reminder views are at `/admin/crm/reminders`.
- Require `tenant_crm.read`, `tenant_crm.manage` for mutation, and effective `tenant_crm` entitlement. Tenant-composite foreign keys protect Clients, staff actors/assignees, Tags, definitions, and values.
- Keep Notes internal, store birthdays as month/day, derive overdue state, and project only note/reminder lifecycle facts without note bodies into the query-time Timeline.
- Store typed custom field values as validated JSONB against relational definitions/options; see ADR-005. No Client columns or Order/Reservation-derived CRM facts were added.

## Implemented in Phase 4

- Add tenant-owned dynamic Segments and deterministic Smart Groups using one typed, bounded criteria compiler. Membership is evaluated from current Client, CRM, Order, and Reservation data; it is not copied or synchronized.
- Provide Tenant Admin pages at /admin/crm/segments and /admin/crm/smart-groups, with metadata-driven criteria editing, preview, and paginated member views.
- Keep current memberships query-derived and historical entry/exit history unavailable. Promotions manual groups and Platform CRM Segments remain separate.
- Require tenant_crm.read and effective tenant_crm for reads; create/update/status changes require tenant_crm.manage. See SEGMENTATION.md for fields, exact metric definitions, preset criteria, operators, bounds, APIs, and query shape.
- Migration 1790620000000-TenantCrmSegments persists criteria only; no Segment-member table or synchronization job exists.
- The focused Segment service suite passed 12/12, including its PostgreSQL tenant-isolation, dynamic-membership, and EXPLAIN case during the Phase 5 regression run. The local fixture is small and does not establish production-scale query performance. Authenticated UI acceptance is pending.

## Implemented in Phase 5

- Add tenant-scoped Programs, lazy Client accounts, an authoritative signed points ledger, reasoned manual adjustments, Rewards, and staff-recorded redemptions.
- Award integer points only for `DELIVERED` Orders using floor of existing payable toman amount divided by the program's versioned spend threshold. Ledger uniqueness prevents duplicate earning per café/Order.
- Keep balance derived from ledger sum; account-row locks and transactions protect manual debits and redemption from overspending. Redemption snapshots name and cost and cannot be edited away by later Reward changes.
- Orders writes a durable `tenant.order.delivered` outbox record in its status transaction. The Tenant CRM processor claims/retries independently; Orders do not call Tenant CRM.
- Add the `/admin/crm/loyalty` program/reward workspace and Client 360 balance, rewards, redemption and paginated history panel. Tenant CRM Timeline includes ledger-backed loyalty projections.
- Keep feature access on effective `tenant_crm`; reads require `tenant_crm.read` and changes require `tenant_crm.manage`. No separate flag, discount/checkout behavior, segment membership, automation, or analytics was added.
- Migration `1790630000000-TenantCrmLoyalty` adds the durable event outbox and tenant-composite Loyalty schema. The focused PostgreSQL test covers independent café balances, duplicate earning, event-time rule snapshots, unfinished Orders, cross-tenant Reward denial, blocked Clients, and competing redemptions.
- The Phase 5 regression run passed workspace typecheck and production build; the full API suite passed 192 tests with 27 skips. Authenticated browser acceptance remains pending.
- See [LOYALTY.md](LOYALTY.md) and [ADR-007](ADR-007-loyalty-ledger-and-order-outbox.md) for the model and limits.

## Implemented in Phase 6

- Add tenant-owned Customer Feedback with required 1–5 rating, optional comment, `MANUAL`/`CUSTOMER_PANEL` source, optional one-per-source Order or Reservation relationship, and `NEW`/`NEEDS_ATTENTION`/`RESOLVED` recovery status.
- Low ratings (`<= 2`) start in Needs Attention. Managers can mark items for follow-up, resolve with a private note, or create the existing Phase 3 Reminder. Resolved items cannot be reopened.
- Add `/admin/crm/feedback`, bounded Client 360 summary/recent Feedback, and `FEEDBACK_RECEIVED` / `FEEDBACK_RESOLVED` Timeline projections. The Timeline does not expose free-text comments or internal notes.
- Existing authenticated Clients can submit or view only their own Feedback from delivered Order or completed Reservation details. Client responses omit recovery status, resolution details, staff identity, and Reminders.
- Migration `1790640000000-TenantCrmFeedback` enforces tenant/Client/source relationships, actor membership, unique source links, and restricts deletion of linked Orders/Reservations. Client deletion follows the existing CRM cascade.
- Keep Segments, Loyalty, Discounts, Campaigns, notifications, Platform CRM, and Analytics behavior independent. See [FEEDBACK.md](FEEDBACK.md) for current behavior and limitations.

## Reading order

1. DOMAIN_MODEL.md
2. MULTI_TENANCY.md
3. IDENTITY.md
4. INTEGRATIONS.md
5. The feature document relevant to the change

## Documents

| Document | Purpose |
| --- | --- |
| DISCOVERY.md | Current implementation facts and conflicts |
| DOMAIN_MODEL.md | Bounded context and concepts |
| DATA_MODEL.md | Current data and future storage rules |
| MULTI_TENANCY.md | Tenant resolution, query and relationship isolation |
| IDENTITY.md | User, Client, normalization, duplicate resolution |
| INTEGRATIONS.md | Ownership and source-of-truth matrix |
| PERMISSIONS.md | Implemented tenant permissions and entitlement contract |
| API.md | Implemented directory, Customer 360, and Phase 3–4 routes |
| UX.md | Tenant Admin CRM screens and interaction rules |
| EVENTS.md | Existing durable mechanisms and future event candidates |
| PRIVACY.md | Current facts and future privacy decisions |
| ANALYTICS.md | Existing reports and future customer measures |
| SEGMENTATION.md | Authoritative Phase 4 Segment, field, operator, and Smart Group semantics |
| LOYALTY.md | Phase 5 earning, ledger, rewards, redemption, event processing, and limits |
| FEEDBACK.md | Phase 6 rating, sources, service recovery, privacy, and API contract |
| TESTING.md | Required isolation and integration coverage |
| PHASES.md | Incremental roadmap and implemented phase contracts |
| ADR-001..008 | Accepted domain, identity, isolation, entitlement, custom-field, segmentation, loyalty, and Feedback decisions |

## Current versus proposed

Statements about current behavior reflect code and migrations; Phases 7–10 remain planned and are not implied by Phases 0–6.


## Implemented in Phase 7

Offers link one saved active CRM Segment to an existing Promotion. Activation snapshots matching Clients, while the Discounts engine remains authoritative for price, coupon use, dates, schedules, and Promotion customer conditions. See [OFFERS.md](OFFERS.md) and [ADR-009](ADR-009-offer-audience-snapshot.md). Campaign messaging, SMS, and automation remain out of scope.
