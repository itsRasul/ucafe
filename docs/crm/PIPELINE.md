# Default sales pipeline

No sales pipeline exists in UCafe today. This is a proposed code-defined default, not a record of current sales operations. Implement one pipeline only when Deal management enters scope; do not add configurable pipeline tables in Phase 0.

## Open stages

| Order | Stage | Meaning |
|---:|---|---|
| 1 | DISCOVERY | Understand the café and establish whether UCafe may fit. |
| 2 | DEMO_SCHEDULED | A product demonstration has a confirmed date/time. |
| 3 | DEMO_COMPLETED | A demonstration happened and its outcome is recorded. |
| 4 | TRIAL_PROPOSED | Trial terms or the next setup step were offered; no Trial is asserted by this stage. |
| 5 | TRIAL_ACTIVE | The prospect is believed to be using a Trial. Display the Subscription module's actual Trial state separately. |
| 6 | DECISION | The café is making or communicating its purchase decision. |

Closing a Deal sets its separate outcome to WON or LOST; do not create fake WON/LOST open stages. WON means explicit commercial acceptance. LOST requires a controlled loss reason such as PRICE, TIMING, PRODUCT_FIT, NO_RESPONSE, COMPETITOR, or OTHER, with optional staff note. Validate and adjust the reason list with operators before Phase 3 ships.

## Stage changes and history

- Store a stable stage key, not a localized label, on the Deal.
- Require an allowed transition and append DealStageHistory with from/to keys, actor, timestamp, and optional reason in the same transaction as the current stage update.
- Forward moves are common; allow skipping a stage only through an explicit action with a reason because sales processes can skip a demo or trial.
- Do not move a Deal back silently. An authorized correction records the previous and next stage and an explanation.
- Closing records outcome, closed_at, and won_at or lost_at. Keep the last open stage for reporting.
- Reopening a closed Deal is not a normal transition. Create a new Deal for a new renewal/reactivation opportunity; use a correction path only for data repair.
- Do not infer stage changes from a CRM Activity, Task completion, Tenant event, Subscription state, or Payment.

History enables a timeline and time-in-stage reporting. The current stage column alone cannot answer those questions.

## Future flexibility

Keep the first stage list code-defined and versioned with its semantics in this document. If UCafe needs multiple product lines, sales teams, or operators with distinct funnels, define pipeline configuration in a later phase. Preserve stage key/label snapshots in history before making configurable labels or changing ordering. Custom pipelines are Phase 7+ at the earliest, after real workflow evidence exists.

