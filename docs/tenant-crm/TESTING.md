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

## Phase 4 Segmentation coverage

The focused Node test file tenant-crm-segments.service.spec.ts checks allowlisted metadata, nested AND/OR SQL composition, mandatory tenant predicates, same-tenant Tag and Custom Field references, parameterized Known Spend values, café-timezone relative dates and this-month, typed custom values including multi-select contains_all JSONB serialization, invalid fields/operators/foreign Tags, archived-field repair visibility, AST depth/condition bounds, preview/member predicate parity and server-side pagination, masked sample phone, foreign Segment 404 behavior, effective tenant_crm gating, and permission metadata. It includes an optional PostgreSQL fixture for dynamic membership after an Order insert, cross-tenant exclusion, and EXPLAIN of the actual criteria query.

At the Phase 4 implementation checkpoint, its optional PostgreSQL integration case was skipped and authenticated RTL acceptance remained pending. Those earlier environment results are historical; use the latest Phase-specific verification below for current status.

## Phase 5 Loyalty coverage

`tenant-crm-loyalty.service.spec.ts` checks exact BigInt floor division and invalid rates, controller permission metadata, tenant-separated same-phone Client balances, foreign Reward denial, concurrent redemption without overspending, same-key redemption replay, current balance reconstruction, blocked Client mutation, and unfinished Order exclusion. Its PostgreSQL integration also inserts duplicate delivery events for one Order, verifies one EARN entry, confirms the event-time program rate snapshot, and uses two service instances to process durable outbox rows. Run it with `npm run test:loyalty --workspace=@ucafe/api`; its database case skips unless `TENANT_CRM_INTEGRATION_DATABASE_URL` is set.

The Phase 5 development run applied migrations `1790620000000-TenantCrmSegments` and `1790630000000-TenantCrmLoyalty`; `migration:show` then reported all 64 migrations applied. Workspace typecheck passed. The focused Loyalty suite passed 4/4 with PostgreSQL enabled; the Segment suite passed 12/12 with its PostgreSQL tenant-isolation, dynamic-membership, and EXPLAIN case enabled. That integration exposed an untyped timezone parameter when criteria had no date field; adding an explicit SQL type fixed it. The full API suite passed (219 tests: 192 passed, 27 skipped, 0 failed), and `NODE_ENV=production npm run build` passed for API, web, and worker. Authenticated desktop/mobile visual acceptance remains pending because the browser has no tenant-admin session. There is no repository lint command.

## Phase 6 Feedback coverage

`tenant-crm-feedback.service.spec.ts` checks 1–5 DTO validation, the fixed 2/3 attention boundary, manual and authenticated customer creation paths, same-Client/tenant source lookup and terminal timing, feedback filters/date timezone/sort/page SQL, Customer 360 summary and five-row bound, safe customer response fields, row-locked resolution and no-reopen behavior, Timeline cursor grammar, tenant CRM permission metadata, and effective feature checks. Its optional PostgreSQL case verifies composite Client/Order/Reservation/member constraints, unique source links, cross-tenant exclusion, café-timezone filtering, summary aggregates, Reminder ownership, and complete Timeline pagination. The focused suite passed 10/10 with the Compose PostgreSQL URL enabled. The full API suite passed (229 tests: 196 passed, 33 skipped, 0 failed); root typecheck and production build passed for API/web/worker. Migration `1790640000000-TenantCrmFeedback` is applied and `migration:show` confirms it. Live unauthenticated route checks returned 200 for the admin page and 401 for the API; authenticated admin/customer RTL acceptance remains pending because no browser E2E harness or signed-in sessions are available. There is no repository lint command.


## Phase 7 Offers coverage

Verify Segment preview/evaluation parity, activation-time membership snapshots and locking, same-tenant constraints, Draft-only edits, irreversible Ended lifecycle, tenant_crm feature and permission gates, PromotionPricingService audience gating, distinct redemption versus Order snapshot counts, Timeline cursor validation, and responsive RTL form status/error states. Apply the forward migration and run API/web typechecks plus the focused Offers, Segment, and Promotion pricing specs.

## Phase 9 automation coverage

`tenant-crm-automation.service.spec.ts` checks bounded/safe retry classification and, with `TENANT_CRM_INTEGRATION_DATABASE_URL`, runs two workers against PostgreSQL to verify tenant-scoped outbox dispatch, stale event and execution reclaim, stale action replay between ordered actions, source-event replay deduplication, sequential idempotent Tag/Note/Reminder effects, Feedback-created rating conditions, Feedback-resolved tag removal, condition-false terminal skip, feature-off event completion, active second-tenant isolation, causal/depth loop blocking, and café-local Birthday/Lapsed occurrence deduplication. The fixture uses separate café identities with the same phone and cleans up all source and execution rows. Run it with `npm run test:automation --workspace=@ucafe/api`.

Current Phase 9 verification: migration `1790660000000-TenantCrmAutomation` is applied and all 67 migrations show executed. The database-backed automation spec passed 3/3; `npm test` passed 211 with 27 unrelated database cases skipped; workspace typecheck and production build passed. The built route table includes `/admin/crm/automations`. In the restarted dev containers, `/admin/crm/automations` returned HTTP 200, API health returned HTTP 200, and the protected `/api/v1/tenant/crm/automations` route returned the expected HTTP 401 without a session. No authenticated Tenant Admin browser session was available, so desktop/mobile RTL, keyboard/focus, and reduced-motion acceptance remains pending. The repository has no browser E2E harness or lint command.
