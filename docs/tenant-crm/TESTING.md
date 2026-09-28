# Tenant CRM testing rules

The repository uses Node's built-in test runner and node:assert for API tests. PostgreSQL integration tests use configured test databases; the web has typecheck/build checks but no durable browser E2E suite. There is no lint command.

Every Tenant CRM phase must cover:

- Tenant A cannot list, search, read, update, archive, export, or aggregate Tenant B data, even with a valid foreign UUID.
- A Tenant A note/profile/segment/loyalty/etc. cannot reference Tenant B's Client or related CRM row; test application rejection and database enforcement.
- Caller-supplied tenantId cannot change resolved scope.
- User and Client remain distinct: only an authorized tenant User operates admin CRM APIs; client tokens cannot read internal CRM data.
- Effective tenant_crm and tenant RBAC are tested separately: disabled feature denies otherwise-permitted users; missing tenant_crm.read denies enabled tenants. Platform crm.read must not satisfy tenant CRM authorization.
- Golden default and Platform Admin plan toggling follow the feature registry; no code path checks a plan name.
- Existing Promotions customer search, manual segments, ordering eligibility, and Tenant Analytics continue to work without tenant_crm.
- Same normalized phone in two cafés remains two independent Client identities and histories; same-café exact duplicates are handled safely.
- Search/pagination apply tenant filters in SQL before page limits and avoid leaking PII in unauthorized projections or logs.
- Background processing, imports, bulk operations, campaign recipients, and exports carry and verify tenant scope.

Phase 1 adds API service tests for tenant-filtered list/search/detail SQL, normalized phone matching, pagination/sorting, phone masking, and safe foreign-ID behavior; controller coverage verifies tenant_crm.read metadata and feature enforcement. The PostgreSQL tests insert two cafés with the same normalized phone, prove isolated search/detail, check same-café uniqueness, and verify Golden/Silver defaults, migration preservation, owner permission, and plan toggling. Set TENANT_CRM_INTEGRATION_DATABASE_URL to run them. Promotions code remains unchanged and does not reference the CRM feature.

Phase 2 adds service/controller tests for CRM DTO composition, feature denial, cursor validation, and exact matching of strict descending tuple order/predicate. Its PostgreSQL fixture verifies delivered-only spend and AOV, zero-denominator behavior, status/reservation counts, created-vs-latest interaction timestamps, Client-created fallback (not administrative `updated_at`), bounded recent rows, foreign-tenant isolation, globally unique Timeline keys, equal-time ordering, and complete multi-page traversal without duplication or omission. The fixture runs `EXPLAIN (ANALYZE, BUFFERS)` on the actual summary, recent Order/Reservation, and first/cursor Timeline queries. At the local test database size (12 Clients, 16 Orders, 13 Reservations including the temporary fixture), PostgreSQL chose sequential scans and bounded top-N sorting; these plans are not representative of production scale and justify no new composite index. Re-run with representative volume before index changes. The application suite has no frontend browser E2E harness; verify the page manually at desktop/mobile RTL sizes when an authorized tenant session is available.

Phase 3 coverage checks note pagination/actor attribution, preference validation, tag assignment idempotency and tenant scope, all supported custom field type validation, required multi-select handling and select option ownership, reminder tenant-timezone views and lifecycle, controller feature/permission metadata, and Timeline projection. With `TENANT_CRM_INTEGRATION_DATABASE_URL`, insert two tenants and verify duplicate tag names coexist, composite foreign keys reject cross-tenant Client/Tag/field/User relations, and service CRUD remains tenant-scoped. Also verify Customer 360 and manager routes at desktop/mobile widths using an authorized tenant session; no browser E2E harness currently exists.

Feature-specific tests add source integration checks for Orders, Reservations, Discounts, and Analytics definitions, plus migration constraints when a phase adds schema. UI work gets manual desktop/mobile RTL, focus/keyboard, loading/empty/error/success, and reduced-motion checks under the existing app test capabilities.

For Phase 0, validation is documentation review, path/link checks, factual comparison to source/migrations, and full diff review. No application tests are required because no executable behavior changes.
