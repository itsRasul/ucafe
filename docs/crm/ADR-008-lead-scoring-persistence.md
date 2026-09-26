# ADR-008: Persist explainable Lead scores

- **Status:** Accepted and implemented in Phase 8
- **Date:** 2026-09-27
- **Decision owner:** Platform CRM

## Context

Phase 7 provides a bounded, typed, parameterized filter compiler. Phase 8 needs deterministic rule contributions and explanation while operational Lead lists must filter/sort by score without evaluating all rule conditions for every list query. CRM uses PostgreSQL in one modular monolith; no CRM event bus or queue exists.

## Decision

Persist one current score row per Lead in `crm_lead_scores`, with Fit, Engagement, Overall, configured state, calculation timestamp, configuration version, and a JSONB contribution explanation. Store append-only score snapshots in `crm_lead_score_history` only when scoring state or explanation changes. Use two categories: signed matching points are summed per category and clamped to 0–100; Overall is the rounded mean of the category values. Keep score separate from manual Priority and Lead lifecycle.

Score rules reuse the Phase 7 Lead criteria AST and compiler. The calculation query evaluates all prepared rules for each batch in PostgreSQL with parameterized criteria, then writes score snapshots. Filtering and sorting read the persisted score row. Rule changes are transactionally versioned and re-score active, unconverted Leads. Lead row locks serialize overlapping recalculations; rule-wide recalculation locks Leads in ID order before the singleton configuration row. Source writes recalculate affected Leads in the same transaction; relative Activity rules refresh at startup and daily with a PostgreSQL advisory lock.

## Alternatives considered

- **Calculate on each read:** freshest by construction, but list sort/filter would require evaluating every enabled rule for every Lead and explanation could differ between repeated pages.
- **Persist score only, no explanation/history:** cheaper storage, but operators could not reliably answer why a score has its value or identify which configuration produced it.
- **Add many score columns directly to `crm_leads`:** rejected because the projection and history have an independent lifecycle and should not widen the core Lead row for each future score type.
- **Add a queue/event bus:** rejected at current CRM scale because the API already has transactional source hooks and no CRM worker/event consumer contract.

## Consequences

- Migration `1790570000000-PlatformCrmLeadScoring` adds `crm_scoring_state`, `crm_scoring_rules`, `crm_lead_scores`, `crm_lead_score_history`, and score/history indexes. Existing Leads receive an unconfigured zero snapshot; new Leads are initialized through the Lead write hook.
- Source-write recalculation is transactionally consistent. Rule mutation recalculation and other synchronous all-Lead recalculation are capped at 5,000 active Leads; requests exceeding that ceiling fail without applying a partial rule change. Recalculation batches contain 100 Leads. At higher volume, replace synchronous all-Lead refresh with a durable, observable worker.
- Relative-day filters become stale as time passes even without source writes, so the API performs a startup and daily keyset batch refresh. Score freshness can lag by up to one day for time-only changes, and scheduled refresh is API-process-hosted.
- Converted Leads freeze their last score; archived Leads preserve theirs. This prevents inactive records from dominating active Lead ordering while retaining their history.
- Scoring does not publish events, create Tasks, change Priority, qualify Leads, move Deals, or mutate customer state. See [SCORING.md](SCORING.md).

## Revisit when

Active Lead volume approaches the 5,000 synchronous ceiling, daily API-hosted refresh is not operationally reliable, representative query plans miss list latency goals, or a real scoring source requires reliable cross-module events. Measure first; add a durable batch worker before raising the cap.
