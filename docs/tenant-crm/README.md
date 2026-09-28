# Tenant CRM

**Status:** Phases 0–2 implemented; authenticated visual acceptance for Phase 2 remains pending because no tenant-admin session is available. Phase 2 composes Customer 360 and a paginated activity view from existing Client, Order, and Reservation rows; it adds no CRM-owned tables.

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
| PERMISSIONS.md | Future tenant RBAC and entitlement contract |
| API.md | Implemented directory routes and API contract rules |
| UX.md | Tenant Admin placement and directory transition |
| EVENTS.md | Existing durable mechanisms and future event candidates |
| PRIVACY.md | Current facts and future privacy decisions |
| ANALYTICS.md | Existing reports and future customer measures |
| TESTING.md | Required isolation and integration coverage |
| PHASES.md | Incremental roadmap and implemented phase contracts |
| ADR-001..004 | Accepted Phase 0 architecture decisions |

## Current versus proposed

Statements about current behavior reflect code and migrations; later roadmap phases remain planned and are not implied by Phases 0–2.
