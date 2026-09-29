# Tenant CRM phases

Phase numbers sequence work; they do not authorize work beyond the agreed phase.

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Architecture, discovery, domain boundaries, and documentation foundation | Complete |
| 1 | Client directory and identity resolution | Implemented |
| 2 | Customer 360 and unified customer timeline | Implemented; authenticated visual review pending |
| 3 | Preferences, notes, tags, custom fields, and reminders | Implemented; authenticated visual acceptance pending |
| 4 | Segmentation and smart groups | Implemented; PostgreSQL regression passed, authenticated visual acceptance pending |
| 5 | Loyalty and rewards | Implemented; authenticated visual acceptance pending |
| 6 | Feedback and service recovery | Implemented; authenticated visual acceptance pending |
| 7 | Offers and Discount targeting | Implemented |
| 8 | Customer communications and campaigns | Deferred |
| 9 | Lifecycle automation and retention journeys | Implemented; authenticated UI acceptance pending |
| 10 | Customer analytics and retention intelligence | Planned |

## Phase 1 contract

Use Client itself as the directory identity; add no duplicate Customer or profile table. Provide read-only paginated tenant-scoped list/search/detail and exact same-café normalized-phone resolution. Mask phone in list rows; allow full phone only on tenant-authorized detail. Do not add admin Client create/edit or automatically merge identities; existing OTP, self-service, and staff reservation paths remain authoritative. Place it at /admin/crm with API routes under /tenant/crm. Use tenant_crm.read and the effective tenant_crm feature on the backend. Golden defaults on; other plans default off; Platform Admin can change every plan. Promotions customer search and manual customer segments keep their current rules. Orders and Reservations remain source modules.

Phase 1 registers `tenant_crm` in the feature catalog, plan-update input and Platform Admin editor; exposes effective access to Tenant Admin; and grants `tenant_crm.read` to owners through migration. Search, sort, status filters, pagination, and detail are tenant scoped. Automated coverage checks tenant SQL scope, normalized phone identity, phone masking, feature gating, and route permission metadata. The UI is Persian RTL and responsive. PostgreSQL isolation integration checks run when `TENANT_CRM_INTEGRATION_DATABASE_URL` is configured.

## Phase 2 contract

Extend the existing Client detail with a read-only Customer 360 projection and one keyset-paginated Timeline; Client, Orders, and Reservations remain the source of truth. Define Known UCafe Spend as the sum of `total_amount_toman` only for current `DELIVERED` Orders, with the stored amount and offline-payment limitations stated without changing Order semantics. Keep source projections minimal and tenant/client scoped; `tenant_crm.read` does not imply `orders.read` or `reservations.read`. Define last interaction as latest Order/Reservation creation or latest currently retained status timestamp, falling back to `Client.created_at` and never `Client.updated_at`.

The Timeline is reconstructed activity, not a durable lifecycle log: show source creation and at most the current status's latest `status_changed_at`; do not invent earlier transitions. Event keys are globally unique across event kinds, and keyset ordering/predicate use the same strict descending `(occurredAt,eventKey)` tuple. Queries are bounded/aggregated in PostgreSQL. Run EXPLAIN on actual queries before considering indexes. Phase 2 adds no CRM tables, migration, or index.

## Scope guard

**Phase 3 contract.**

Phase 3 provides explicit CRM preferences, internal notes, manually configured tenant tags, typed custom fields, and manual reminders integrated into Customer 360 and the Timeline projection. It adds owner-granted `tenant_crm.manage`; all reads and writes also retain effective feature gating and tenant scoping. Two forward migrations create CRM-owned tables with tenant-composite foreign keys. Phase 4 Segmentation is implemented in code. Its dynamic criteria, persistence, field definitions, endpoints, and verification status are documented in SEGMENTATION.md. Client-facing CRM data, reminder delivery, and CRM analytics remain outside earlier phases.

## Phase 4 contract

Persist a tenant-owned named criteria AST, then evaluate it against the current tenant Client population and authoritative Client, CRM, Order, and Reservation rows whenever preview or membership is requested. Do not persist member IDs or create a synchronization worker. One allowlisted typed compiler serves draft preview, saved Segment preview/member routes, and Smart Groups. Keep Promotions customer groups and Platform CRM filtering independent.

Migration 1790620000000-TenantCrmSegments adds criteria-only Segment persistence, tenant-composite identity and creator constraints, tenant-local case-insensitive names, and a tenant listing index. Reads require tenant_crm.read plus the effective tenant_crm feature; create/update/status changes also require tenant_crm.manage. Relative dates use the resolved café time zone. Archived Tag/Custom Field references remain stored and are shown as invalid until repaired; they are not reinterpreted.

Phase 4 implementation includes AST/value validation, nested AND/OR, Client and explicit preference fields, tenant Tags, typed Custom Fields, Phase 2-aligned current Order/Reservation metrics, fixed deterministic Smart Groups, paginated member queries, and Persian RTL Tenant Admin pages. The 12-test Segment suite and its PostgreSQL isolation/dynamic-membership/EXPLAIN case passed during Phase 5 regression; the small local fixture does not establish production-scale query performance. Authenticated visual acceptance is pending. Phase 4 is therefore implemented but not marked complete under the Definition of Done.

## Phase 5 contract

Use the existing Client identity and effective `tenant_crm` entitlement. Add a versioned spend-per-point program, lazy tenant/Client account, signed authoritative ledger, manual credits/debits, tenant Rewards, and atomic staff redemptions. Earning is integer floor division of current `DELIVERED` Order payable toman amount by the configuration effective when the transactional Order-delivered outbox event was written. Preserve historical entries and snapshots, prevent negative balances under account-row locks, and enforce uniqueness for earning per tenant/Order.

Migration `1790630000000-TenantCrmLoyalty` creates tenant-composite persistence and the PostgreSQL outbox. Orders only writes the durable event; a CRM-owned consumer claims/retries it and no-ops without effective CRM entitlement. Reward redemption is not checkout or a Discount. The Customer 360 panel and `/admin/crm/loyalty` workspace use existing CRM permissions and Persian RTL patterns. Segmentation, Campaign, Automation, expiry, refund reversals, and Loyalty analytics stay outside Phase 5. Focused database tests and migration application passed; see LOYALTY.md and TESTING.md. Authenticated visual acceptance remains pending.

No Campaign, consent, automation, dynamic membership persistence, analytics implementation, search service, broker, separate database, or microservice was introduced by Phase 5.

## Phase 6 contract

Phase 6 stores customer responses in `tenant_crm_feedback`, rooted in the existing tenant Client identity. Ratings are required integers 1–5; 1–2 is the fixed negative threshold and starts at `NEEDS_ATTENTION`; ratings 3–5 start at `NEW`. Customer-panel responses may link to one delivered Order or completed Reservation belonging to the same Client and tenant, with one response per linked source. Manual entries are staff-attributed and may be unlinked. Staff can mark attention or resolve with an optional private note; resolution is row-locked, records actor/time, is idempotent, and cannot be reopened.

Tenant Admin inbox/detail, bounded Customer 360 summary/recent records, and Timeline projection use effective `tenant_crm`; reads require `tenant_crm.read` and mutations require `tenant_crm.manage`. The customer-panel form uses the existing authenticated Client and exposes only its own rating/comment/source/time. Follow-up uses the existing Reminder. Migration `1790640000000-TenantCrmFeedback` enforces tenant/client/source and actor references. Feedback does not add ticketing, review invitations, Segment fields, Campaign, Offers, automation, automatic loyalty/discount/SMS changes, or analytics. Focused tests and schema checks are recorded in [TESTING.md](TESTING.md); authenticated desktop/mobile visual acceptance remains pending.


## Phase 7 contract

Implemented Offers link saved active Segments to existing Promotions, snapshot the current audience atomically on activation, and add that snapshot to the existing Discounts eligibility path. Customer 360 and Timeline expose targeting and saved discount applications without creating Campaigns, SMS delivery, new pricing, or redemption accounting. See [OFFERS.md](OFFERS.md).

## Phase 8 status

**Deferred.** Tenant-funded SMS billing, wallet, or quota must exist before high-volume customer messaging is enabled. Phase 8 covers communications and Campaigns; SMS, WhatsApp, email, message delivery, and communication journeys are not prerequisites for Phase 9.

Phase 9 proceeds independently and is limited to internal Tenant CRM lifecycle actions. Communication actions are intentionally excluded. Phase numbers remain unchanged.

## Phase 9 contract

Phase 9 adds tenant-scoped durable lifecycle definitions, immutable execution snapshots, ordered actions, retry/stale recovery, event dispatch, and café-local birthday/lapsed scans. Supported sources are Order delivered and Feedback created/resolved; supported actions are Tag add/remove, internal Note, and staff Reminder. Event fields and current-state criteria reuse Phase 4's typed compiler. Execution history records safe error codes and action outcomes. Existing runs finish after pause, and activation does not backfill events created before activation.

Phase 9 does not require Phase 8, send communications, grant Offers, mutate Loyalty, infer Segment enter/exit, or invent Client/Reservation events that have no durable source. See [AUTOMATION.md](AUTOMATION.md). The focused PostgreSQL recovery/idempotency/concurrency checks, migration state, workspace checks, and authenticated UI acceptance are recorded in [TESTING.md](TESTING.md).
