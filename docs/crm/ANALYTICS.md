# CRM analytics data requirements

No standalone platform CRM analytics/reporting page is implemented. Current /admin/analytics is Tenant Analytics and has separate Tenant permissions and plan-feature gates. The Phase 3 pipeline board exposes operational per-stage open Deal counts and sums of optional estimates; these are not a historical report and must not be presented as collected revenue. Phase 5 adds operational Organization 360 counts, last Activity, next Task, and recent previews, all derived from current source records. These values are not historical analytics, persisted metrics, funnels, or revenue. Lead status history, Deal stage history, Activities, and selected Task lifecycle timestamps can support later metric definitions without changing their source ownership.

## Data to preserve from the first workflow phase

| Future question | Required CRM data |
|---|---|
| How many prospects entered by source and when? | Stable Lead source key, optional campaign/reference, created_at, and source_request_id when from the public form. |
| How quickly are Leads qualified or converted? | Implemented `qualified_at`, `converted_at`, explicit status history, and Organization/Contact conversion links. |
| Which stages stall? | Stable Deal stage keys, ordered stage history, entered/exited timestamps, actor, and any skipped-stage reason. |
| What was won or lost and why? | Explicit WON/LOST outcome, won_at/lost_at, controlled loss reason, optional note. |
| What is forecast pipeline value? | Optional integer-Toman estimated amount, currency/unit definition, current stage/outcome snapshots and dates. |
| Which follow-ups help? | Activity type/time/actor, Task created/due/completed/canceled timestamps and assignee. |
| How do customer lifecycle events relate to sales? | Optional CRM Organization-to-Tenant link plus read-only subscription/trial facts with source IDs and timestamps. |

Deal estimated value and closed-won counts are sales measures, not collected revenue. Payment, subscription, and tenant facts remain separate. Do not calculate a paid-revenue metric from a Deal, Tenant status, or plan price.

Phase 3 retains stage history from the first Deal release. The current stage alone cannot support time-in-stage, historical funnels, or conversion-by-stage reports. Preserve a stable Lead source key and avoid overwriting source attribution when a Lead changes status.

Phase 7 Segments are operational saved criteria, not analytics or campaign audiences. Their counts are current matches only; they do not provide historical membership, funnel attribution, scoring, or outcome measures.

Analytics should begin in Phase 10 after enough CRM data exists. Use bounded SQL aggregates over indexed histories, return business measures rather than UI colors, and define periods/timezone before reporting. Do not add a CRM Analytics plan feature or couple to tenant Analytics without a product decision.
