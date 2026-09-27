# Lead scoring

Phase 8 provides configurable, deterministic points to help CRM staff review Leads. A score is a rule result, not a probability or recommendation. It never qualifies/unqualifies a Lead, changes manual Priority, changes a Deal, creates a Task, sends outreach, or changes Tenant/Subscription state.

## Model and formula

Each active Lead has Fit, Engagement, and Overall values from 0 to 100. For each category, sum the signed points of all enabled, non-archived rules whose criteria match, then clamp the total to `[0, 100]`. Negative contributions are retained in the explanation and can reduce a positive total. Overall is `Math.round((fitScore + engagementScore) / 2)`. Both categories have equal weight; an empty category scores zero. This direct formula is stable and does not imply an unobserved conversion probability.

The UI labels Overall bands as Low (`0–39`), Medium (`40–69`), High (`70–84`), and Very high (`85–100`). A Lead with no enabled rules has zero values and `configured=false`; this differentiates an unconfigured score from a configured zero. Once a rule exists, a matching score may still be zero because of no matching contributions or negative points.

## Rules and criteria

A scoring rule has a name, optional description, category (`FIT` or `ENGAGEMENT`), one Phase 7 version-1 flat AND/OR criteria AST, signed points from -100 through 100, enabled state, and sort order. A maximum of 100 rules can be enabled. The rule sort order and stable ID order control explanation display; they do not change the sum.

Criteria use the existing Lead field registry, typed operators and value checks, Tag UUID validation, custom-field type validation, and stable select-option IDs. There is no scoring-specific query syntax, nested logic, free-form SQL, formula, AI, or arbitrary aggregation. Fit describes prospect characteristics; Engagement describes recorded interactions. Rules express operator-configured UCafe policy; UCafe business assumptions are not hardcoded as weights.

An enabled rule referencing a field/Tag/option that is later archived remains visible and reports a configuration warning. It stops contributing until the rule is repaired or disabled. Archiving a rule is soft, disables it, bumps the configuration version, and recalculates active Leads. Disabling retains the rule and its criteria. Updating rule configuration recalculates all active, unconverted Leads in the same transaction.

## Supported fields and source limits

The Lead rule registry currently contains:

- Lead business name, city, status, source, manual priority, creation date.
- Lead custom fields and Tags, using Phase 7 validation and stable identifiers.
- Activity count, last Activity date, days since last Activity, whether a completed Demo exists, and whether a Connected Call exists. Archived Activities do not count. The relative day count uses elapsed 24-hour days and one captured evaluation timestamp during a scoring pass.
- Persisted score fields are available to Lead filters and Segments but are rejected in scoring rules, preventing recursive scoring.

Activity signals include records directly linked to the Lead and Organization-level Activities linked to the same Organization when the Lead has an Organization. An Activity linked to another Lead does not count. Contact, Organization attributes/custom fields/Tags, Tasks, Deals, Tenant/Trial/Subscription context, Notes, free text, and customer health are not score inputs in this phase. In particular, an open Task reflects seller intent and is not evidence of customer engagement.

## Persistence, explanation, and history

`crm_lead_scores` stores the current three bounded values, a `configured` flag, global scoring configuration version, contribution breakdown, and calculation timestamp. The breakdown records raw category total, clamped category value, and matched rule ID/name/category/points. No Lead PII or free-text Note/Activity content is copied into the score snapshot.

`crm_scoring_state` is a singleton version row. Each successful rule create/update/archive increments the version. `crm_lead_score_history` stores a snapshot when a value, configured state, version, or explanation actually changes; a repeated no-op recalculation does not add history. The endpoint returns the latest 10 snapshots. Rule changes are also recorded as PII-free `platform_audit_events` actions. Score changes are emitted only to the Phase 9 transactional Workflow outbox; they are not Timeline items.

Persisted scores keep Lead list sorting/filtering inexpensive and allow Saved Views and Segments to use the ordinary server-side Phase 7 compiler. The tradeoff is source-change invalidation and score freshness, handled below. [ADR-008](ADR-008-lead-scoring-persistence.md) records the persistence choice.

## Recalculation and lifecycle

Scoring runs through one calculation service. Lead creation/update/status/qualification changes and restoration recalculate the affected Lead in the source transaction. Overlapping recalculations serialize on the Lead row so concurrent Activity changes cannot leave an older aggregate as the last score. Rule changes acquire active Lead locks in stable ID order before the global configuration lock, keeping source-write and config lock ordering consistent. Conversion evaluates once immediately before the Lead becomes CONVERTED, then preserves that historical score; converted Leads are never included in active recalculation. Archiving preserves the last score. A manual recalculation request handles an active Lead; it does not re-score a converted/archived one.

Activity create/update/archive/restore recalculates directly linked Leads and active unconverted Leads linked to an affected Organization. Lead custom-field definition/value changes and Lead Tag assignment/archive recalculate affected Leads (or all active Leads when a shared definition/Tag changes). Rule changes recalculate all active, unconverted Leads. Contact, Task, Deal, Organization profile, Tenant, and Subscription writes do not affect score because those fields are not in the rule registry.

Relative-activity rules can change their match without a row write. An API process triggers refresh shortly after startup and daily thereafter, only when an enabled rule references `daysSinceLastActivity`. PostgreSQL advisory locking permits one API process to run the refresh; the job keyset-pages active Leads in 100-row batches. The refresh uses a single captured timestamp per batch. A downtime longer than a day is corrected on startup. No durable queue/worker is introduced.

Rule changes and synchronous shared metadata recalculation are capped at 5,000 active Leads. A request above this threshold fails and rolls back instead of committing a partial score set. The next scale step is a durable background batch worker with visible progress/retry state. Per-Lead recalculation and activity-linked recalculation also enforce bounded work.

## Filtering, API, and permissions

The existing Lead list can filter on `fitScore`, `engagementScore`, `overallScore`, `scoreCalculatedAt`, and the listed Activity signals; it can sort by each score value. Score fields are available to Lead Saved Views and Segments and use SQL predicates before pagination. No score sort was added for other entity types.

Scoring routes are listed in [API.md](API.md). `crm.read` grants rule listing, match preview, score/history read, and score filtering. `crm.manage` grants rule mutation and explicit recalculation. Criteria/value validation comes from the same Phase 7 compiler; the score-column prohibition is a separate recursion guard. Manual Priority, status, qualification, Deal, and customer state remain independently managed.

## Phase 9 Workflow events

When a stored Fit, Engagement, or Overall score changes, the same source transaction writes `LEAD_SCORE_CHANGED` to the CRM Workflow outbox with previous/current score values. `LEAD_SCORE_CROSSED_THRESHOLD` matches only a real transition across the configured integer threshold; a first score with no previous value is not a crossing. Scoring does not depend on Workflow execution, and score no-ops do not publish an event. See [AUTOMATION.md](AUTOMATION.md).

## Not included

No organization/contact/deal score, AI/ML or conversion likelihood, default UCafe weights, customer health, campaigns, or outreach are implemented. Workflow-created Tasks are supported in Phase 9. Phase 10 reports descriptive Lead score bands; see [ANALYTICS.md](ANALYTICS.md). A band is not conversion probability.
