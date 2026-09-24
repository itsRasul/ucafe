# Project continuation checkpoint

Last updated: 2026-09-24

## Inventory Phase 0/1 stabilization

The observed Inventory 404s came from a development Nest process started before the new module was registered; direct API requests and `/api/backend` requests both changed from route-level 404 to auth-level 401 after an API restart. The `/tenant/subscription` route was already registered. Inventory now rejects normalized duplicate category/location names, blocks writes to inactive items, rejects duplicate count lines and oversized page numbers, pages count history, and uses movement indexes for recent history and per-balance lookups. The admin UI pages stock/counts and refreshes filtered datasets independently. Migration `1787840000000` is applied in the local development database. An authenticated read-only smoke test through the BFF returned 200 for all seven Inventory GET routes and 400 for invalid category/location POST bodies. The PostgreSQL Inventory integration test, workspace typecheck, full test suite, and production build passed; authenticated visual UI testing remains pending because this browser session has no admin login.

## Inventory Phase 1

Implemented tenant-scoped item/category/location management, stock balances, opening movements, manual adjustments, immutable movement history, overview and physical counts. Inventory endpoints require the configurable entitlement and tenant RBAC. Added migration `1787835600000-InventoryOperations` for categories/count snapshots and protected-owner permission grants. The UI lives at `/admin/inventory` and exposes overview, stock/item management, count entry, movement history, locations, and categories. Count completion rebases each line over movements recorded after its count timestamp and creates reconciliation movements transactionally.

Verification: full API suite passed (92 tests, including PostgreSQL analytics/inventory integration); workspace typecheck and API/web production builds passed. Migrations `1787832000000` and `1787835600000` are applied in the development database, and `/admin/inventory` returns HTTP 200 in the dev web service. Known limits: items, stock rows, and counts are capped to the UI's first 100; history UI filters item/location/type but not dates; count search is deferred. Phase 2 starts with versioned recipes referencing inventory item IDs, per [INVENTORY.md](INVENTORY.md).

Repository checkpoint remains in [CURRENT_STATE.md](CURRENT_STATE.md); this file records the Inventory continuation point requested for the feature work.
