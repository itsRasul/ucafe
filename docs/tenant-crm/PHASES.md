# Tenant CRM phases

Phase numbers sequence work; they do not authorize work beyond the agreed phase.

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Architecture, discovery, domain boundaries, and documentation foundation | Complete |
| 1 | Client directory and identity resolution | Implemented |
| 2 | Customer 360 and unified customer timeline | Implemented; authenticated visual review pending |
| 3 | Preferences, notes, tags, custom fields, and reminders | Implemented; authenticated visual acceptance pending |
| 4 | Segmentation and smart groups | Planned |
| 5 | Loyalty and rewards | Planned |
| 6 | Feedback and service recovery | Planned |
| 7 | Offers and Discount targeting | Planned |
| 8 | Customer communications and campaigns | Planned |
| 9 | Lifecycle automation and retention journeys | Planned |
| 10 | Customer analytics and retention intelligence | Planned |

## Phase 1 contract

Use Client itself as the directory identity; add no duplicate Customer or profile table. Provide read-only paginated tenant-scoped list/search/detail and exact same-café normalized-phone resolution. Mask phone in list rows; allow full phone only on tenant-authorized detail. Do not add admin Client create/edit or automatically merge identities; existing OTP, self-service, and staff reservation paths remain authoritative. Place it at /admin/crm with API routes under /tenant/crm. Use tenant_crm.read and the effective tenant_crm feature on the backend. Golden defaults on; other plans default off; Platform Admin can change every plan. Promotions customer search and manual customer segments keep their current rules. Orders and Reservations remain source modules.

Phase 1 registers `tenant_crm` in the feature catalog, plan-update input and Platform Admin editor; exposes effective access to Tenant Admin; and grants `tenant_crm.read` to owners through migration. Search, sort, status filters, pagination, and detail are tenant scoped. Automated coverage checks tenant SQL scope, normalized phone identity, phone masking, feature gating, and route permission metadata. The UI is Persian RTL and responsive. PostgreSQL isolation integration checks run when `TENANT_CRM_INTEGRATION_DATABASE_URL` is configured.

## Phase 2 contract

Extend the existing Client detail with a read-only Customer 360 projection and one keyset-paginated Timeline; Client, Orders, and Reservations remain the source of truth. Define Known UCafe Spend as the sum of `total_amount_toman` only for current `DELIVERED` Orders, with the stored amount and offline-payment limitations stated without changing Order semantics. Keep source projections minimal and tenant/client scoped; `tenant_crm.read` does not imply `orders.read` or `reservations.read`. Define last interaction as latest Order/Reservation creation or latest currently retained status timestamp, falling back to `Client.created_at` and never `Client.updated_at`.

The Timeline is reconstructed activity, not a durable lifecycle log: show source creation and at most the current status's latest `status_changed_at`; do not invent earlier transitions. Event keys are globally unique across event kinds, and keyset ordering/predicate use the same strict descending `(occurredAt,eventKey)` tuple. Queries are bounded/aggregated in PostgreSQL. Run EXPLAIN on actual queries before considering indexes. Phase 2 adds no CRM tables, migration, or index.

## Scope guard

**Phase 3 contract.**

Phase 3 provides explicit CRM preferences, internal notes, manually configured tenant tags, typed custom fields, and manual reminders integrated into Customer 360 and the Timeline projection. It adds owner-granted `tenant_crm.manage`; all reads and writes also retain effective feature gating and tenant scoping. Two forward migrations create CRM-owned tables with tenant-composite foreign keys. Phase 4 Segmentation, automation, client-facing CRM data, reminder delivery, and CRM analytics remain planned. Automated service checks, the PostgreSQL isolation fixture, migration verification, and workspace typecheck pass; the local browser has no tenant-admin session for authenticated visual acceptance.

No loyalty, campaign, consent, automation, custom fields, dynamic segments, customer 360, analytics implementation, search service, broker, separate database, or microservice is part of Phase 0.
