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

No payment settlement, refund ledger, historical order events, or recurring-pattern confidence measure exists. Phase 3 should begin with the order-item snapshots and category ownership rules, while preserving this phase's tenant scope and delivered-order outcome semantics.

## Limits and extension

Delivered value is not verified payment. There is no historical status event table, so prior outcomes can be restated by direct data repair. Custom ranges are bounded to 366 days. There is no reservation report, refund accounting, guest identity, or multi-branch breakdown. Add a payment/refund ledger before paid-revenue or financial settlement reporting. Phase 2 should add focused peak-time views using the established local-time bucketing rule, without changing the Overview definitions.

At the end of each analytics phase, update this file with implemented metrics/endpoints/database changes, decisions, limits, and the next recommended phase.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Analytics Foundation | Completed |
| 1 | Overview Dashboard | Completed |
| 2 | Time & Peak Analytics | Completed |
| 3 | Product & Category Analytics | Not Started |
| 4 | Customer Analytics | Not Started |
| 5 | Order & Channel Analytics | Not Started |
| 6 | Reservation Analytics | Not Started |
| 7 | Financial Analytics | Not Started |
| 8 | Cost & Profitability | Not Started |
| 9 | Product Profitability Matrix | Not Started |
| 10 | Growth & Comparative Analytics | Not Started |
| 11 | Automated Insights | Not Started |
| 12 | Advanced BI / Forecasting | Not Started |
