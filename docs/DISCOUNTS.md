# Discounts and promotions

## Phase 0

Tenant-owned promotions target one or more products and/or categories. A reward is `PERCENTAGE`, `FIXED_AMOUNT`, or `FIXED_PRICE`. Promotion dates are optional UTC instants, activation is explicit, and deletion uses the existing soft-delete convention. Category targets apply to their current menu items; no per-product copies are created.

Owners and staff with `menu.manage` can create, edit, activate, deactivate, and archive promotions through `/tenant/promotions`. Users with `menu.read` can list and read them. Public menu prices and quote responses expose only price values and the winning promotion label needed by the storefront.

## Price calculation

`PromotionPricingService` loads the active, tenant-scoped promotions and their targets once for a menu or checkout pricing operation. `MenuService` uses it to price base products and each variant; `POST /public/ordering/quote` returns a current cart quote; `OrderingService` calls it again inside the existing order-creation transaction. The quote is informational and checkout always recalculates from database menu and promotion state. The browser submits only item/variant IDs and quantities.

One promotion is selected per unit. The largest discount in integer toman wins. Equal savings use the higher priority, then the lexically smaller promotion UUID. Start time is inclusive and end time exclusive. Inactive, archived, upcoming, and expired promotions are ignored. No winning promotion or a fixed promotional price above a particular item's/variant's price leaves the original price unchanged.

Percentage savings round to the nearest toman, half up. Fixed amounts are capped at the current unit price, and fixed promotional prices cannot raise it. The final unit price is therefore never negative. Catalogue base and variant prices remain unchanged. Current and original prices are computed in the same service and represented as decimal integer strings at API/persistence boundaries.

## Persistence and history

`promotions` stores tenant, reward, priority, activation, schedule, and soft-delete state. `promotion_targets` stores exactly one product or category reference per row. Queries include the resolved `coffeeShopId`; target creation validates tenant ownership, and database foreign keys plus a trigger reject cross-tenant references.

Orders retain `subtotal_before_discount_toman`, `discount_total_toman`, and the existing `total_amount_toman` payable amount. Each order item retains its original unit price, discounted unit price, per-unit discount, and a detached snapshot of the winning promotion ID, name, reward type, and value. Snapshot promotion IDs intentionally have no foreign key: editing or archiving a promotion cannot change an order. The migration backfills historical orders as full-price orders with zero discount.

Customer orders currently use offline payment and have no delivery fee or fee/tax allocation. The recorded total is the discounted amount due at delivery. Analytics continues to use net order and item totals; promotion snapshots preserve gross sales and discount attribution for future reports.

## Time, permissions, and extensions

The admin uses the device's local `datetime-local` timezone and sends UTC ISO timestamps. The API and database never interpret a browser or Tehran wall-clock value as UTC; status is evaluated against one server timestamp per price operation.

Promotion operations reuse resolved tenant context and the existing menu permissions; no tenant ID is accepted from the request. Public read paths use the current tenant host and do not rely on a shared price cache. React request memoization remains request-local.

Phase 0 deliberately has no stacking, exclusive policy, coupons, order-level rewards, recurring schedules, minimums, usage counters, BOGO, bundles, customer segments, or generic JSON rules language. New typed reward or condition types can be introduced behind the pricing service without changing catalogue prices or historical snapshots.
