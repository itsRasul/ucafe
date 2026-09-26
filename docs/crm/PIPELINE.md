# Default sales pipeline

UCafe implements one code-defined pipeline, key `ucafe-default`, with no database pipeline/stage tables or configuration UI. It is the operational sales workflow, not a claim that Tenant, Trial, or Subscription state matches a stage.

## Open stages

| Order | Stage | Meaning |
|---:|---|---|
| 1 | DISCOVERY | Understand the café and establish whether UCafe may fit. |
| 2 | DEMO_SCHEDULED | A product demonstration has a confirmed date/time. |
| 3 | DEMO_COMPLETED | A demonstration happened and its outcome is recorded. |
| 4 | TRIAL_PROPOSED | Trial terms or the next setup step were offered; no Trial is asserted by this stage. |
| 5 | TRIAL_ACTIVE | The prospect is believed to be using a Trial. Display the Subscription module's actual Trial state separately. |
| 6 | DECISION | The café is making or communicating its purchase decision. |

Closing a Deal sets its separate outcome to WON or LOST; do not create fake WON/LOST open stages. WON means explicit commercial acceptance. LOST requires one reason from PRICE, TIMING, PRODUCT_FIT, NO_RESPONSE, COMPETITOR, or OTHER; optional detail is allowed only for OTHER.

## Stage changes and history

- Store the stable stage key and `ucafe-default` on the Deal.
- Append DealStageHistory with from/to keys, actor, timestamp, and optional reason in the same transaction as each stage write.
- Forward adjacent moves need no reason. Skips and backward corrections require an explicit reason (maximum 500 characters).
- Closing records outcome, closed_at, and won_at or lost_at. Keep the last open stage for reporting.
- Reopening a closed Deal is not a normal transition. Create a new Deal for a new renewal/reactivation opportunity; use a correction path only for data repair.
- Do not infer stage changes from a CRM Activity, Task completion, Tenant event, Subscription state, or Payment.

History enables the operational history view and future time-in-stage reporting. The current stage column alone cannot answer those questions. Stage summary counts and estimated amounts are operational board totals, not recognized or collected revenue.

## Future flexibility

If UCafe needs multiple product lines, sales teams, or operators with distinct funnels, consider configuration only after real workflow evidence exists. Preserve stable history semantics if stage labels/order change.
