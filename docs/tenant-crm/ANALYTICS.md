# Tenant CRM analytics

## Current source

Tenant Analytics already reports customer counts/rankings, repeat behavior, and delivered-order value from tenant-scoped Orders and Client IDs. Its eligible order outcome is DELIVERED at status_changed_at in café-local time. Order payment is OFFLINE, so delivered value is not verified cash collection. External or physical POS sales absent from UCafe are not represented.

## Future measures

Possible CRM measures include customer count, repeat behavior, Known UCafe Spend or Tracked Order Spend, completed Orders, completed/no-show Reservations, loyalty, retention, RFM, and campaign performance. Each requires a written definition and authoritative timestamp/source before implementation.

Use Orders for order facts and amounts, Reservations for booking facts, Discounts/redemptions for offer use, and CRM-owned records only for CRM facts. Do not duplicate Analytics calculations or claim total customer spend where coverage is incomplete. Do not expose cross-café benchmarks or aggregate one café's customers into another tenant's view.

No analytics tables, counters, materialized views, indexes, or refresh jobs are proposed for Phase 0. Prefer bounded tenant-filtered SQL over loading full record sets. Add indexes or read models only after representative query plans and measured need.
