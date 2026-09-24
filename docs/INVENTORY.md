# Inventory

## Phase 1 status

Phase 1 is implemented. The `inventory` plan feature remains configurable, defaults on for Golden only when the key is absent, and every inventory service operation checks the resolved entitlement. Tenant-admin routes additionally require `inventory.read` or `inventory.manage`; tenant identity comes from the authenticated request context. Turning the feature off denies access but retains all records. After adding Inventory to a running development API, restart that process so Nest registers the new module routes; the Next.js `/api/backend` proxy already forwards them.

## Goals and non-goals

The system tracks café stock with a tenant-safe, auditable movement ledger and a fast current balance. Phase 1 provides items, categories, locations, stock views, opening balances, manual adjustments, physical counts, movement history, and an operational overview. Recipes, order depletion, suppliers, purchasing, waste workflows, alerts, costing, advanced reports, integrations, forecasting, and multi-branch transfers remain deferred.

## Terms and foundation entities

- **Inventory item:** a stock-managed resource with tenant, name, optional SKU/description, measurement dimension, base unit, active state, and timestamps.
- **Inventory category:** a flat tenant-owned label; deleting is avoided and deactivation preserves item history.
- **Inventory location:** a tenant-owned physical stock location. At most one location per tenant is marked default; the first inventory location read creates `Main Inventory` if none exists.
- **Stock movement:** an immutable signed quantity change with item, location, type, optional cost/source/idempotency key/actor/reason/metadata, and creation time.
- **Stock balance:** cached quantity for one tenant/item/location pair. It is a projection, not history or independent truth.

The schema retains future movement vocabulary, while Phase 1 writes only `OPENING_BALANCE`, `MANUAL_ADJUSTMENT`, and `STOCK_COUNT_ADJUSTMENT`.

## Units, quantity and cost

Each item has one dimension (`WEIGHT`, `VOLUME`, or `COUNT`) and one base unit. The current allowed base-unit codes are `g`/`kg`, `ml`/`l`, and `piece`/`pack`/`box`/`bottle`. Dimension/unit agreement is constrained in PostgreSQL. Package conversions such as one box to 24 bottles are item-specific and not implemented; no cross-dimension conversion is valid. Convert quantities to the item's base unit before writing a movement.

Quantity and unit cost use PostgreSQL `numeric(20,6)`. TypeORM exposes these as decimal strings. Keep calculations in decimal arithmetic in the write path; never round-trip stock values through JavaScript `number`. Money elsewhere in UCafe remains integer toman; `unit_cost_toman` is a decimal unit cost and future totals must define their rounding boundary.

## Ledger, balances, concurrency and idempotency

Movements are append-only; PostgreSQL rejects update and delete. Corrections use compensating movements. The unique nullable `(coffee_shop_id,idempotency_key)` index provides a tenant-scoped deduplication key. Source type/ID are descriptive references and are not assumed to be globally unique.

The ledger is historical truth. The balance table is a rebuildable projection keyed by tenant/item/location. Movement posting and balance increment occur in one transaction after locking the stable balance row and rechecking idempotency. No direct balance mutation endpoint exists; stock lists use the projection, not full-ledger sums. Negative balances are allowed and shown as operational warnings.

## Tenant security and lifecycle

Every table carries `coffee_shop_id`; movement/balance item and location references are composite tenant-scoped foreign keys, preventing cross-tenant references in PostgreSQL. Read/write APIs must obtain tenant identity from `TenantContextGuard`, never request body input. Inventory feature changes gate access but retain all stored records. Tenant deletion follows the platform's existing tenant retention/deletion policy; this migration cascades with deletion of the tenant row.

## Plans, permissions and audit

`inventory` is registered in `subscriptionFeatureCatalog` and the existing platform plan editor's typed feature DTO. Golden's migration default is applied only if that key is absent, preserving any platform decision. Feature resolution remains the shared effective-subscription check (`TRIALING`, `ACTIVE`, or `GRACE` plus a true plan value), never a plan-name check.

Tenant RBAC uses `inventory.read` and `inventory.manage`, granted to the protected owner role. The manage permission controls every stock mutation. Movement actor, reason, time and source preserve operational attribution; tenant stock operations do not use platform-only audit events.

## Integration boundaries

- **Menu:** future recipe links belong to a menu item or variant as appropriate; menu products need not have recipes. Preserve menu tenant ownership and recipe version history.
- **Orders:** future consumption is generated from immutable order item snapshots and recipe versions; cancellation creates reversal movements. Use an idempotency key per source operation. UCafe is not assumed to be the only POS/source.
- **Analytics:** operational stock screens require `inventory`; a future inventory report surfaced in Analytics may require both `inventory` and `analytics`. Analytics owns report aggregation and presentation; Inventory owns stock facts and movement history.
- **Suppliers/purchasing:** receipts will generate movements and snapshot purchase/unit costs. Supplier and purchase-order records are deferred.
- **Waste:** waste should generate a reasoned negative movement, not edit balance directly.
- **Recipes and actual-vs-theoretical:** version recipes and preserve the recipe version/source used for each consumption. Actual usage comes from counts/movements; theoretical usage derives from fulfilled sales and recipe snapshots. Variance is a comparison, not a second stock ledger.
- **Forecasting:** use bounded historical demand and local café time rules from Analytics; forecasts/recommendations remain advisory until explicitly accepted into purchasing.

## Phased roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Feature, schema and architecture foundation | Implemented |
| 1 | Items, categories, locations, balances, adjustments, counts and history | Implemented |
| 2 | Menu/variant recipes and recipe versioning | Planned |
| 3 | Order consumption and reversal | Planned |
| 4 | Suppliers, purchasing, receipts and purchase costs | Planned |
| 5 | Waste, minimum stock and PAR alerts | Planned |
| 6 | Recipe costing and menu profitability | Planned |
| 7 | Actual vs Theoretical usage and variance | Planned |
| 8 | Lots, expiry and FIFO/FEFO | Planned |
| 9 | Supplier price history and purchase recommendations | Planned |
| 10 | Demand and inventory forecasting | Planned |
| 11 | Invoice import/OCR and external integrations | Planned |
| 12 | Transfers and advanced multi-location support | Planned |

## Phase 1 behavior and API

Tenant routes under `/tenant/inventory` cover items, categories, locations, stock, movements, adjustments, counts, and overview. Items with movement history are deactivated instead of deleted. Opening quantity is optional on item creation and, when positive, creates one `OPENING_BALANCE` movement in the same transaction as the item. Manual adjustments require a signed nonzero base-unit quantity, reason, actor, and idempotency key. Categories are flat and tenant-scoped. Locations can be renamed, activated/deactivated (the active default cannot be deactivated), and one location per tenant can be default.

All admin requests use the existing `AdminSessionProvider` API client: `/api/backend/tenant/inventory/...` forwards path, method, query, body, credentials, and tenant host to Nest's `/api/v1/tenant/inventory/...`. `InventoryController` applies access token, tenant context, and tenant permission guards; each `InventoryService` method checks the `inventory` plan entitlement. The shared admin shell's subscription request uses `/api/backend/tenant/subscription` and its existing subscription controller.

| Method and suffix | Service method |
| --- | --- |
| `GET overview` | `overview` |
| `GET/POST categories`, `PATCH categories/:id` | `categories`, `createCategory`, `updateCategory` |
| `GET/POST locations`, `PATCH locations/:id` | `locations`, `createLocation`, `updateLocation` |
| `GET/POST items`, `PATCH items/:id` | `items`, `createItem`, `updateItem` |
| `GET stock`, `POST adjustments`, `GET movements` | `stock`, `adjust`, `movements` |
| `GET/POST counts`, `GET counts/:id` | `counts`, `createCount`, `countDetail` |
| `PATCH counts/:id/lines`, `POST counts/:id/complete` | `saveCountLines`, `completeCount` |

Counts move from `DRAFT` to immutable `COMPLETED`. Each entered line snapshots the balance and `counted_at` when that physical quantity is submitted. At completion, the service adds ledger movements strictly after that line's timestamp to its counted quantity, then reconciles to the current balance. This preserves intervening operations; a count line is entered in the item's base unit. Items, stock, counts, and movement lists are paginated (maximum 100 rows per request); the UI pages stock/count history and loads item catalog pages for selectors. Overview reports active items, negative balances, draft counts, and recent manual adjustments. The admin UI is Persian-first and RTL with Overview, Stock/Items, Counts, History, and Settings views. Category and location names are unique per tenant after trimming and case folding. Inactive items cannot receive manual adjustments or new count lines.

Migration `1787832000000` creates the Phase 0 ledger foundation; `1787835600000` adds categories, counts, count immutability, item category linkage, and owner permissions. Migration `1787840000000` adds normalized category/location uniqueness and movement indexes for history and balance lookups. API tests and a PostgreSQL integration scenario cover decimal behavior, entitlement, idempotency, rebase-on-concurrency, transaction consistency, validation, and tenant isolation. Phase 2 can add versioned recipes that reference stable inventory item IDs; no recipe or order deduction behavior is included here.
