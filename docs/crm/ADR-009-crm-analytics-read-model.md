# ADR-009: Derive CRM Analytics directly from source tables

- **Status:** Accepted and implemented in Platform CRM Phase 10
- **Date:** 2026-09-27
- **Decision owner:** Platform CRM

## Context

Phase 10 needs operational funnels, pipeline movement, work, automation, and customer lifecycle reporting. The CRM already retains relational Lead/Deal histories, work records, workflow executions, and read-only links to Tenant Subscription facts. The current CRM volume does not justify duplicating these facts into a second persisted reporting model.

## Decision

Add bounded read-only CRM Analytics query services in the existing API and PostgreSQL module. Aggregate directly from authoritative domain tables with parameterized SQL and reuse the existing Analytics period helper. Read customer status through the Subscription domain's effective-status rules. Keep Tenant Analytics, CRM sales estimates, and payments separate. Add no Analytics table, materialized view, index, cache, worker, or external reporting service in this phase.

Every metric has an explicit event timestamp or created-Lead cohort, denominator, filter scope, and known limit documented in [ANALYTICS.md](ANALYTICS.md). Customer source attribution is omitted where a durable Lead-to-Tenant conversion relationship is not available. Current-state snapshots are labeled separately from range events.

## Alternatives considered

- **Materialized reporting tables/views:** faster repeated reads, but introduce refresh, backfill, reconciliation, and a second data lifecycle before measured latency or data volume requires one.
- **Generic BI/query builder or analytics service:** broadens the product beyond deterministic operational CRM measures and adds infrastructure without a current consumer need.
- **Re-use the Tenant Analytics domain:** rejected because it is tenant-owned commerce reporting with different authorization, event meanings, and measures.

## Consequences

- Phase 10 adds read queries, DTO validation, routes, and a Persian RTL CRM report page; it adds no database migration.
- PostgreSQL aggregates bounded source data; application code does not load full CRM entity sets. Subscription lifecycle remains owned by `SubscriptionsService`.
- Customer lifecycle reports require both `crm.read` and `subscriptions.read`; labels mask owner contact identifiers.
- Historical gaps remain visible: owner changes, due-date edits, score-at-conversion, current Segment membership, and multi-Lead customer attribution cannot be reconstructed consistently.
- Empty local CRM data cannot establish production-scale query plans. Measure production cardinalities/latency before adding indexes, caching, or persistence.

## Revisit when

Representative production query plans or observed response latency show direct aggregation cannot meet the CRM reporting target, or multiple consumers need a stable cross-domain snapshot. Introduce only the smallest measured read model and define reconciliation/backfill before materializing metrics.
