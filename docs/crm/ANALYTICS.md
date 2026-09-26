# CRM analytics data requirements

No platform CRM analytics is implemented. Current /admin/analytics is Tenant Analytics and has separate Tenant permissions and plan-feature gates. Platform CRM reporting must be separate and must not reinterpret cafe order value as sales revenue. Phase 2 now retains Lead source, `created_at`, `qualified_at`, `converted_at`, `source_request_id`, and append-only status history as the minimum Lead funnel source data.

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

Keep stage history from the first Deal release. The current stage alone cannot support time-in-stage, historical funnels, or conversion-by-stage reports. Preserve a stable Lead source key and avoid overwriting source attribution when a Lead changes status.

Analytics should begin in Phase 10 after enough CRM data exists. Use bounded SQL aggregates over indexed histories, return business measures rather than UI colors, and define periods/timezone before reporting. Do not add a CRM Analytics plan feature or couple to tenant Analytics without a product decision.
