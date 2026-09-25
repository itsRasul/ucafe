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

## Phase 1

A promotion can target the entire order without target rows. An optional `promotion_coupons` row activates that same promotion by a code; coupons are not a second pricing engine. Codes are ASCII letters, digits, `_`, or `-`, 3–64 characters. The API trims surrounding whitespace, folds ASCII case to uppercase, and compares the stored normalized code within the resolved tenant. A code can be reused by another cafe. One coupon per order is supported.

The existing pricing service still selects the best product/category promotion per unit. Checkout then calculates one order-stage promotion against the item subtotal **after item discounts**, before any order discount or delivery fee. A coupon can target the entire order or selected products/categories; selected targets use their already-discounted unit prices. The largest automatic entire-order or submitted coupon saving wins, breaking ties by priority and ID. A code that would lose to an automatic reward returns `PROMOTION_NOT_APPLICABLE` so applying it cannot reduce the customer's existing saving. Thus an item promotion and one order-stage reward can stack; there is no exclusive/stackable policy or multiple-coupon stacking. The same promotion is never selected at both stages. The optional minimum compares the whole post-item-discount subtotal. A percentage cap limits the order-stage reward; fixed amounts floor merchandise at zero. Delivery fees are currently zero and are not discountable. Money remains integer toman with half-up percentage rounding.

`POST /public/ordering/quote` remains the anonymous base quote. Authenticated `POST /public/ordering/coupon-quote` accepts the same cart lines plus `couponCode` and reports the current item and order discount breakdown. Neither preview writes a redemption. Final `POST /public/orders` accepts only the code, recalculates from database prices and promotion state, and saves immutable order-level promotion, reward, code, and amount snapshots. Historical orders are unaffected by later promotion edits or archival.

The authenticated client is the per-customer identity. At checkout, the coupon row is locked for the transaction, live `APPLIED` redemptions are counted, and the order plus redemption are inserted atomically. The existing order idempotency key returns the original order without another redemption; checkout keeps the same key for a same-payload retry in browser session storage, including after a refresh. Offline payment is the only customer-order method, so a successful order consumes its coupon immediately. Canceling while still `UNDER_REVIEW` releases it; cancellation after preparation does not restore use, because collection is not tracked. A released redemption remains as history and does not count against limits. No gateway request or online customer-order payment exists in this product flow.

Coupon and redemption queries use tenant scope, and database foreign keys/triggers reject mixed-tenant references. The per-coupon row lock serializes total and per-customer limit checks even for simultaneous checkouts. There is no price or usage cache. Happy Hour, recurring schedules, BOGO, bundles, segments, loyalty, analytics UI, online order payment, and a generic rule language remain outside this phase.
