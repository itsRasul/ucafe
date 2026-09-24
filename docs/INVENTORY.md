# Inventory

## Phase 2 status

Phase 2 is implemented. Recipes are optional per menu item or variant, versioned, Inventory-feature-gated, and tenant-scoped. Draft edits replace that draft's components with an optimistic revision check; publishing atomically activates the draft and supersedes the prior active version. Published components are immutable in the API and protected by a database trigger. Recipe operations do not post stock movements.

Phase 1 is implemented. The `inventory` plan feature remains configurable, defaults on for Golden only when the key is absent, and every inventory service operation checks the resolved entitlement. Tenant-admin routes additionally require `inventory.read` or `inventory.manage`; tenant identity comes from the authenticated request context. Turning the feature off denies access but retains all records. After adding Inventory to a running development API, restart that process so Nest registers the new module routes; the Next.js `/api/backend` proxy already forwards them.

## Goals and non-goals

The system tracks café stock with a tenant-safe, auditable movement ledger and a fast current balance. Phase 1 provides items, categories, locations, stock views, opening balances, manual adjustments, physical counts, movement history, and an operational overview. Phase 2 adds versioned menu recipes. Order depletion, suppliers, purchasing, waste workflows, alerts, costing, advanced reports, integrations, forecasting, and multi-branch transfers remain deferred.

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

- **Menu:** recipes link to a menu item or its existing variant; menu products need not have recipes. Variant IDs remain stable during edits; removed variants become unavailable so recipe and order history retain their references.
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
| 2 | Menu/variant recipes and recipe versioning | Implemented |
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

All admin requests use the existing `AdminSessionProvider` API client: `/api/backend/tenant/inventory/...` forwards path, method, query, body, credentials, and tenant host to Nest's `/api/v1/tenant/inventory/...`. Inventory and recipe controllers apply access token, tenant context, and tenant permission guards; every service operation checks the `inventory` plan entitlement. The shared admin shell hides Inventory navigation when the feature is unavailable.

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

Migration `1787832000000` creates the Phase 0 ledger foundation; `1787835600000` adds categories, counts, count immutability, item category linkage, and owner permissions. Migration `1787840000000` adds normalized category/location uniqueness and movement indexes for history and balance lookups. API tests and PostgreSQL integration scenarios cover decimal behavior, entitlement, idempotency, rebase-on-concurrency, transaction consistency, validation, and tenant isolation.

## Phase 2 recipes

### Model and lifecycle

- `inventory_recipes` is the stable identity, unique per tenant/menu item or per tenant/menu variant. It has no delete API. A menu item may have a base recipe and variant recipes; resolving a variant prefers its exact recipe and falls back to the base recipe. Sibling variants never inherit from each other.
- `inventory_recipe_versions` has monotonically increasing per-recipe integers and `DRAFT`, `ACTIVE`, or `SUPERSEDED` status. There can be one draft and one active version per recipe. Creating a new draft copies active components. A row lock on the recipe serializes version-number allocation and publication; unique indexes are the final boundary.
- Draft component replacement checks the caller's `revision`, then increments it in one transaction. Concurrent stale editors receive a conflict instead of silently overwriting one another.
- Publication validates the target and components, supersedes the prior active version, activates the draft, records publisher and `effective_from`, and updates the recipe atomically. A partial unique index enforces one active version. Failed publication rolls back without disturbing the current active version.
- Published and superseded version metadata and component rows cannot be mutated through direct SQL, except that publication may transition the active version to superseded. Corrections create a new draft/version. Database triggers protect history in addition to service checks.
- Each component stores the inventory item ID, its name when the draft was saved, display quantity/unit, normalized quantity in that item's existing base unit, and optional note. Quantities use the Phase 0 exact decimal converter (up to six fractional places); weight accepts `g`/`kg`, volume `ml`/`l`, and count accepts only the item's base unit. Quantities are positive and each ingredient may occur once per version.
- Inactive inventory items cannot be newly added. Existing references remain valid in history and can be copied into a draft; deactivating an item does not rewrite prior recipes.

### Menu and tenant behavior

Menu items and variants are related through tenant-scoped composite foreign keys. Menu item deletion remains the existing soft delete. Menu variant edits retain row IDs; variants removed from the edit form become unavailable rather than physically deleted. This keeps recipe targets and historical order references intact. Recipes for archived menu items remain readable but cannot be published again.

Recipe creation validates the current tenant's menu target. Components validate tenant ownership and compatible units on the backend; the database enforces tenant-scoped foreign keys to menu and inventory rows. The existing `inventory.read`/`inventory.manage` permissions and shared `inventory` entitlement apply. Disabling the feature denies API/UI access but does not delete recipe data.

The recipe list shows configured and missing menu targets, version state, component count, and availability. `/admin/menu` links to recipe management when Inventory entitlement and permission are present. `/admin/inventory/recipes` supports draft editing, history viewing, publishing, and copying an active recipe to a new target. It uses the existing admin API client and Persian RTL inventory styles.

### API

Routes are under `/api/v1/tenant/inventory/recipes`:

| Method | Route | Permission | Behavior |
| --- | --- | --- | --- |
| `GET` | `/` | `inventory.read` | Coverage rows, including menu targets without recipes |
| `GET` | `/:id` | `inventory.read` | Target and all version/component history |
| `POST` | `/` | `inventory.manage` | Create target recipe and empty v1 draft |
| `POST` | `/:id/versions` | `inventory.manage` | Create next draft, copying the active version |
| `PATCH` | `/:id/versions/:versionId/components` | `inventory.manage` | Replace draft components with revision check |
| `POST` | `/:id/versions/:versionId/publish` | `inventory.manage` | Validate and atomically publish |
| `POST` | `/:id/duplicate` | `inventory.manage` | Copy active components into v1 draft for another target |

`RecipesService.resolveActiveRecipe(tenantId, menuItemId, variantId?)` is the Phase 3 resolution entry point. It resolves exact variant first, then the base item recipe, and returns a stable `recipeVersionId` with normalized components. Every call checks the shared Inventory entitlement.

Migrations `1787844000000` and `1787847600000` add recipe tables, composite tenant foreign keys, target/version/component uniqueness and positive quantity constraints, plus published-version/component immutability. `apps/api/src/inventory/recipes.spec.ts` covers entitlement denial, DTO constraints and a rollback-only PostgreSQL lifecycle scenario including tenant isolation, units, inactive ingredients, stale drafts, publication, history, copy, resolution and no stock movements.

### Phase 3 integration guidance

Phase 2 does not change orders, balances, or movements. Phase 3 should snapshot `recipeVersionId` on each order line when the order operation applies the recipe, or on each related stock movement; retaining both the source order-item ID and recipe-version ID on consumption movements gives the clearest audit trail. Historical order analysis must use that version ID rather than looking up the current active recipe. `effective_from` supports reports where no consumption snapshot exists, but does not replace a version snapshot.

Modifiers/add-ons can later add optional modifier-level recipe components alongside the base recipe. Prep recipes can add a production-output item component once that workflow is explicitly scoped; Phase 2 has no recursive recipe graph. Recipe costing, order consumption/reversal, and actual-vs-theoretical reporting remain deferred.
