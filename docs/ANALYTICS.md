# Analytics

## Scope and sources

The analytics module reports tenant order outcomes. `orders` is the source of truth for status, customer, event time, and immutable total in integer toman. `clients.id` identifies a unique cafe customer. `coffee_shops.timezone` (default `Asia/Tehran`) defines calendar boundaries. Menu and order-item snapshots, reservations, subscription payments, and payment intents are outside this first endpoint. Subscription gateway payments are not cafe sales.

Current records have no customer-order settlement, refund, discount, tax, delivery fee, or profit ledger. Order payment is `OFFLINE` only. Consequently `revenueToman` means **delivered order value**, not confirmed cash collected. A future payment ledger must introduce a separately named paid/refunded metric; it must not silently reinterpret historical delivered value.

## Canonical definitions

| Metric | Rule |
| --- | --- |
| Completed order | Current status `DELIVERED`; counted at `status_changed_at` |
| Cancelled order | Current status `CANCELED`; counted at `status_changed_at` |
| Rejected order | No rejected status exists; there is no rejected count |
| Revenue | Sum of `orders.total_amount_toman` for `DELIVERED` orders at `status_changed_at`; pending and cancelled orders contribute zero |
| Unique customers | Distinct `client_id` among delivered orders in the period; every current order has a cafe-scoped client; no guest orders exist |
| Average order value | Delivered order value / delivered order count, rounded half-up to whole toman; zero when count is zero |

The status constants are in `ordering/order-status.util.ts`, shared with the order domain. Because orders store only the latest status and timestamp, this is a current-state report, not an immutable historical event ledger. A later status correction would restate results. No current API allows changing a terminal order.

## Time and comparison

`analyticsRanges` produces half-open local calendar date ranges `[start, endExclusive)`. PostgreSQL converts each boundary from the cafe's IANA timezone to a `timestamptz` instant. The app process timezone is untouched, and DST changes are resolved by PostgreSQL. An order exactly at a local midnight belongs to the new day.

Supported periods: `today`, `yesterday`, `last7Days`, `last30Days`, `currentMonth`, `previousMonth`, `currentYear`, `previousYear`, and `custom`. Rolling periods include today. Calendar periods use full local days/months/years, including the future portion of an in-progress day/month/year. Custom `start` and `end` are inclusive Gregorian ISO dates, limited to 366 days. Their comparison is the immediately preceding same number of local dates. Calendar month/year comparisons use the previous calendar month/year. `yesterday` compares to the day before yesterday.

`compareMetric` returns `{value, previousValue, change, changePercent}`. All integer fields are decimal strings to retain bigint precision. Percent is a two-decimal string, or `null` when the previous value is zero, including zero-to-zero. Empty sums and counts are `"0"`; AOV is `"0"` with no completed orders.

Time-series contracts are chart-library-neutral: `AnalyticsPoint { bucket, label, value }` and `AnalyticsSeries { key, label, points }`. The granularity model supports hour/day/week/month/year. The Overview endpoint automatically chooses hour for one day, day for 2–45 days, week for 46–120 days, and month for 121–730 days. The custom-range cap currently means year buckets are a supported model but are not selected by this endpoint. PostgreSQL groups delivered orders once for all buckets and produces zero-filled buckets. Hour buckets use UTC instants anchored to local midnight, preserving 23/25-hour DST days; other buckets use local cafe dates. Week buckets are adjacent seven-day spans starting at the selected range's first day, not ISO calendar weeks. Bucket AOV uses the same half-up integer formula.

## Architecture, security, and performance

`GET /api/v1/tenant/analytics/overview` accepts an optional `period` (default `today`) or `period=custom&start=YYYY-MM-DD&end=YYYY-MM-DD`. It returns the period, timezone, local current/previous bounds, chosen granularity, compared revenue, completed orders, cancelled orders, unique customers, and AOV, plus current-period revenue/order/AOV series. Malformed, reversed, oversized, or mismatched range input returns 400. The page exposes all supported periods and a Jalali custom date input; the API receives Gregorian ISO dates and remains authoritative for boundaries and comparisons. The UI displays the previous period through KPI changes and a compact comparison section, without aligning unlike calendar dates in a chart.

The controller requires administrative access token, resolved tenant context, and `analytics.read`. The migration grants this tenant permission to the protected `owner` role; a cafe-specific role may be granted it through existing RBAC. Clients and platform roles have no implicit access. No tenant ID is accepted from the request. The service requires `coffeeShopId`, every SQL query filters `orders.coffee_shop_id`, and responses include no PII.

Analytics is the configurable subscription feature key `analytics`, labeled “آمار و گزارش‌های مالی” in the plan catalog. Golden receives it by default through migration `1787824800000`, which writes only when that key is absent; lower plans remain disabled unless an administrator enables them. This is a seed default, **never a plan-name access rule**. Platform Admin toggles it in the existing plan editor; plan updates preserve unknown feature keys. The effective subscription feature set is authoritative: `SubscriptionsService.requireFeature` enforces it on every Overview request and returns the same `FEATURE_UNAVAILABLE` 403 as other gated modules. Existing trial, active, grace, expiry, upgrade, and scheduled-downgrade logic applies without Analytics-specific lifecycle code. The owner navigation remains permission-aware like Ordering/Reservations; a permitted user whose plan lacks Analytics sees the existing-style unavailable state with a link to plans.

One PostgreSQL query aggregates both periods using conditional `SUM`, `COUNT`, and `COUNT(DISTINCT client_id)`; a second groups current-period outcomes and joins generated buckets. Neither loads order entities or item rows. Existing `(coffee_shop_id, created_at)` and `(coffee_shop_id, status, created_at)` indexes serve order administration, not outcome-time reporting. Phase 0 added `IDX_orders_tenant_status_changed` on `(coffee_shop_id, status, status_changed_at)`; Phase 1 needs no additional index. Check query plans under production volume before adding more indexes or caching. No Redis cache is used.

## Phase 2: time and peak analytics

`GET /api/v1/tenant/analytics/time-distribution` accepts the same period DTO as Overview and returns `period`, `timezone`, `current`, `hours`, `weekdays`, `heatmap`, `dates`, and `peaks`. It uses the same administrative token, tenant context, `analytics.read` permission, and effective subscription `analytics` feature check. No tenant identifier or feature key is accepted from the caller. The frontend adds a **تحلیل زمانی** tab under `/admin/analytics` and shares its period selector with Overview.

The canonical event remains the current `DELIVERED` order's `status_changed_at`; `revenue` is delivered order value in integer toman, represented as decimal strings. PostgreSQL filters by cafe, status, and the half-open local period bounds, then groups by local Gregorian date and local hour with `AT TIME ZONE coffee_shops.timezone`. It returns one row per active date/hour combination, never raw orders. The service sums this bounded result into four complete projections: 24 hour-of-day buckets, seven weekdays in Saturday–Friday order (stable English keys), a 7 × 24 day/hour grid, and every local date in the selected period, including zero dates. An hour bucket combines that hour across all selected dates; it is distinct from Overview's chronological series. The calendar uses the existing 366-day custom-range limit. No new index or migration is needed: the Phase 0 `(coffee_shop_id, status, status_changed_at)` index supports the filter. Query plans should be revisited under production data volume before adding expression indexes or caching.

`peaks` contains arrays `revenueHours`, `orderHours`, `revenueWeekdays`, `orderWeekdays`, `revenueDates`, `orderDates`, and `lowestActiveRevenueDates`. Every bucket tied for the positive maximum is returned in chronological or Saturday-first order. An empty dataset returns empty peak arrays; zero days are never called weakest. The lowest active date considers only dates with completed orders and returns all minimum-revenue ties. Peak labels describe only the selected period, including one-day selections. The UI renders separate bar charts for revenue and orders, a metric-switching weekly heatmap, and daily calendar cells with exact values available by focus, hover, and tap. Persian labels and Jalali date display are presentation only; API dates remain Gregorian ISO. The heatmap and calendar colors are selected by the UI; the API returns business values only.

No payment settlement, refund ledger, historical order events, or recurring-pattern confidence measure exists.

## Phase 3: product and category analytics

`GET /api/v1/tenant/analytics/products` accepts the shared period fields plus `limit` (default 10, maximum 20). It returns a bounded product summary, revenue/quantity/low-performing rankings, absolute-revenue growth and decline rankings, Top 5 plus Others contribution, active products without sales, category rankings, and zero-filled trends for the five highest-revenue categories. `GET /api/v1/tenant/analytics/products/:productId` validates the UUID against the resolved tenant and returns product revenue, quantity, distinct containing-order count, realized average selling price, product revenue share, previous-period comparisons, and zero-filled revenue/quantity trends. Both routes reuse the existing administrative guards, `analytics.read` permission, effective `analytics` feature entitlement, cafe timezone, period ranges, granularity, delivered status, and `status_changed_at` semantics.

Product identity is the stable `order_items.menu_item_id`. Rows whose source item is no longer addressable fall back to a snapshot key derived from `item_name`; these historical rows remain in rankings but do not expose a product-detail link. Active and soft-deleted products display the current product name so renames do not split one product into multiple identities. The response marks unavailable, archived, and no-longer-addressable products. The immutable order-item `item_name` remains the fallback display value.

Product revenue is gross realized item revenue: the sum of immutable `order_items.line_total_toman` for delivered orders. Quantity is `SUM(order_items.quantity)`, not order-item row count. Orders containing a product/category use distinct order IDs. Average selling price is item revenue divided by quantity with half-up whole-toman rounding. UCafe currently has no order discount, fee, tax, tip, refund, or customer-payment ledger, and order totals are created as the exact sum of item line totals, so product/category revenue reconciles with Overview delivered value. If order-level adjustments are introduced, Analytics must define allocation before retaining this reconciliation claim.

Migration `1787828400000` adds `category_id_snapshot` and `category_name_snapshot` to order items. New checkout lines copy the owned category at sale time; category aggregation therefore does not reclassify later sales when a product moves or a category is renamed/deleted. The migration backfills existing rows from each product's category at migration time. That is the best recoverable value, but it cannot reconstruct earlier category moves; rows whose product was already unlinked remain `بدون دسته‌بندی`. This pre-migration limitation is explicit and is not presented as exact historical category truth.

Ranking responses never include unlimited rows. Revenue and quantity rankings are separate; the low-performing list includes only products with positive current-period sales, while active available products with zero sales are returned separately. Contribution computes Others from raw revenue (`total - Top N`) before percentage formatting. Percentages are display values truncated to two decimals and never feed financial sums. Growth and decline are sorted by absolute revenue change and also expose the centralized percentage comparison; a zero previous value produces `null`, never infinity. This avoids ranking tiny bases by percentage alone.

The web adds a `محصولات و منو` Analytics tab with summary KPIs, ranking modes, exact-value tables, contribution bars, category performance/trend, tenant-validated product drill-down, growth/decline lists, and a separate zero-sale view. Tables scroll within their panels on narrow screens, selectors remain labeled, charts are keyboard-focusable, and empty/loading/error/entitlement states reuse the existing Persian RTL Analytics surface.

No additional query index was added. Product queries first constrain delivered orders through `IDX_orders_tenant_status_changed` and reach their items through `IDX_order_items_order`; query plans should be checked with production-scale data before adding a product/category expression index. Variant rows remain aggregated under their parent product because the product ID is the stable sale identity. Variant and modifier analytics are deferred; modifiers are not represented as standalone saleable order items.

## Inventory Phase 7 integration

The Analytics page also hosts the Inventory Phase 7 count-to-count usage report at `/admin/analytics`. This report is separate from delivered-sales Analytics definitions and requires both `analytics` and `inventory` permissions and effective plan features. The API reuses Inventory's completed physical counts, immutable movement ledger, valid source references and order-item recipe-version snapshots. Actual depletion is bounded by per-item count timestamps; theoretical usage is signed sale consumption net of valid reversals; known waste and other explained consumption remain separate. Since Phase 8 may store multiple count allocations per item, the report sums those batch/unallocated rows back to one item/location count before calculating actual use. See [INVENTORY.md](INVENTORY.md) for formulas, effective movement timestamps, source validation, the created-at-based order coverage proxy, limitations, endpoints and tests.

The order coverage percentage compares order items created between the count records' completion times with lines having a `SALE_CONSUMPTION` movement; it is not an acceptance-event measure because orders do not retain lifecycle history. Missing recipe usage is never inferred. External sales not recorded in UCafe do not appear in theoretical usage. Historical variance cost is returned unavailable because current balance average cost is not a historical count-time snapshot; no current price is used as past cost. The CTE report executes as one set-based calculation with a tenant/location/item/created-time movement index and returns bounded, separately pageable item rows plus a whole-filter summary.

## Limits and extension

Delivered value is not verified payment. There is no historical status event table, so prior outcomes can be restated by direct data repair. Custom ranges are bounded to 366 days. There is no reservation report, refund accounting, guest identity, or multi-branch breakdown. Add a payment/refund ledger before paid-revenue or financial settlement reporting. Inventory Phase 6 menu profitability is a separate current-cost estimate; it does not change delivered-sales revenue or provide historical margin. A future Analytics profitability report needs both Analytics access and a defined historical cost basis. Phase 2 should add focused peak-time views using the established local-time bucketing rule, without changing the Overview definitions.

At the end of each analytics phase, update this file with implemented metrics/endpoints/database changes, decisions, limits, and the next recommended phase.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Analytics Foundation | Completed |
| 1 | Overview Dashboard | Completed |
| 2 | Time & Peak Analytics | Completed |
| 3 | Product & Category Analytics | Completed |
| 4 | Customer Analytics | Not Started |
| 5 | Order & Channel Analytics | Not Started |
| 6 | Reservation Analytics | Not Started |
| 7 | Financial Analytics | Not Started |
| 8 | Cost & Profitability | Not Started |
| 9 | Product Profitability Matrix | Not Started |
| 10 | Growth & Comparative Analytics | Not Started |
| 11 | Automated Insights | Not Started |
| 12 | Advanced BI / Forecasting | Not Started |

Inventory Phase 9 keeps replenishment gaps, supplier comparison, latest/previous receipt prices, and draft PO assistance inside Inventory. These are operational snapshots of current stock settings and posted Goods Receipts; they require the Inventory entitlement only. Historical purchase-spend, category spend, or long-term supplier price trends remain future Analytics work and must not be inferred from the operational comparison screen.
