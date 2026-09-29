# Tenant CRM analytics

## Current source

Tenant Analytics already reports customer counts/rankings, repeat behavior, and delivered-order value from tenant-scoped Orders and Client IDs. Its eligible order outcome is DELIVERED at status_changed_at in café-local time. Order payment is OFFLINE, so delivered value is not verified cash collection. External or physical POS sales absent from UCafe are not represented.

## Phase 2 Customer 360 measures

These are operational profile summaries, not a separate Analytics report or a claim of complete customer spend.

| Measure | Definition and source |
| --- | --- |
| Tracked Orders | Count every current Order for the tenant/Client, regardless of status. |
| Delivered Orders | Count current `DELIVERED` Orders, the canonical successful fulfilled terminal state defined by Orders. |
| Canceled Orders | Count current `CANCELED` Orders; they do not contribute to spend/AOV. |
| Known UCafe Spend | `SUM(orders.total_amount_toman)` for current `DELIVERED` Orders only. The integer-toman field is the final amount payable after recorded discounts (`subtotal_before_discount_toman - discount_total_toman`), not proof that offline cash was collected. No refund ledger, tax/delivery-fee fields, or off-platform/POS coverage exists; CRM does not redefine source financial semantics. Zero qualifying Orders returns `0`. |
| Average delivered Order value | Known UCafe Spend divided by delivered Order count, rounded to whole toman using PostgreSQL numeric `ROUND` (half away from zero); `null` when denominator is zero. |
| Reservation counts | Count all current Reservations and separately count `COMPLETED`, `CANCELED`, `REJECTED`, and explicit `NO_SHOW`; never infer no-show from schedule time. |
| First seen | `Client.created_at`, not first Order/Reservation. |
| Last interaction | Greatest of each tenant/Client Order or Reservation `created_at` and its non-null latest `status_changed_at`; if no such source interaction exists, `Client.created_at`. Administrative `Client.updated_at` is excluded. This is a relationship-activity timestamp; a latest status transition may be staff-initiated and is not asserted to be customer-initiated. |

First/last Order and Reservation summary dates use their source `created_at`; latest interaction additionally considers the currently retained latest status transition. No historical event time is inferred beyond those columns. Timeline pages recompute against live current source rows, so a concurrent source change between pages may change the reconstructed activity set; keyset order/pagination is deterministic for an unchanged set, not a snapshot-history guarantee.

## Future measures

**Phase 3 dimensions.**

Tags, explicit preferences, custom-field values, and reminder status/due time are CRM-owned sources. Phase 3 added no filtering, segmentation, scoring, cross-client aggregate, or analytics behavior. Phase 4 adds current query-derived Segments over these sources and the Client, Order, and Reservation data. This is operational audience filtering, not a CRM Analytics report; source measures continue to come from their authoritative tables.

Possible CRM measures include customer count, repeat behavior, Known UCafe Spend or Tracked Order Spend, completed Orders, completed/no-show Reservations, loyalty, retention, RFM, and campaign performance. Each requires a written definition and authoritative timestamp/source before implementation.

Use Orders for order facts and amounts, Reservations for booking facts, Discounts/redemptions for offer use, and CRM-owned records only for CRM facts. Do not duplicate Analytics calculations or claim total customer spend where coverage is incomplete. Do not expose cross-café benchmarks or aggregate one café's customers into another tenant's view.

No analytics tables, counters, materialized views, indexes, or refresh jobs are proposed for Phase 0. Prefer bounded tenant-filtered SQL over loading full record sets. Add indexes or read models only after representative query plans and measured need.

## Phase 4 membership boundary

Segment preview/member counts describe matches at query time. There is no historical membership snapshot, transition event, customer-lifetime attribution, campaign response measure, or saved analytics aggregate. A later analytics phase may use a current Segment predicate only after defining its own reporting window and historical semantics.

## Phase 5 Loyalty boundary

Current balance is derived from signed ledger entries at read time; accounts contain no cached balance or analytics counters. The CRM profile exposes a single Client's balance and short history for operations, not a cross-client dashboard or retention metric. Earning uses the current `DELIVERED` Order amount semantics but does not alter or extend Analytics aggregates. Loyalty measures in analytics, retention, or Segmentation remain future work and require explicit windows and history semantics.

## Phase 6 Feedback boundary

Customer 360 may show per-Client Feedback count, one-decimal average rating, count rated 1–2, current Needs Attention count, and last Feedback time. These are operational profile facts, not tenant-wide analytics. Feedback does not add aggregate tables, charts, cross-customer averages, resolution-time claims, or causal attribution. Future metrics such as negative-feedback rate or resolution time belong to Phase 10 and need defined time windows and lifecycle semantics.


## Phase 7 Offer measures

Offer audience count comes from activation-time membership rows. Recorded redemption count comes from applied promotion_redemptions after activation. Applied-order count is separately derived from positive order/order-item Promotion snapshots within the Offer lifecycle. The latter is an application measure, not a coupon redemption measure; the two counts can overlap and have distinct source records.
