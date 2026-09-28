# Tenant CRM

**Status:** Phases 0–4 implemented in code. Phase 4 API/UI typechecks and focused API tests pass; its PostgreSQL integration and authenticated visual acceptance remain pending because the integration database, Docker engine, and tenant-admin session are unavailable.

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
- API/web workspace typechecks and focused Segment service tests passed. The optional PostgreSQL integration test was skipped because its URL is unset; authenticated UI acceptance is pending.

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
| TESTING.md | Required isolation and integration coverage |
| PHASES.md | Incremental roadmap and implemented phase contracts |
| ADR-001..006 | Accepted domain, identity, isolation, entitlement, custom-field, and segmentation decisions |

## Current versus proposed

Statements about current behavior reflect code and migrations; later roadmap phases remain planned and are not implied by Phases 0–4.
