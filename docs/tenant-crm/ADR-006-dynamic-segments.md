# ADR-006: Tenant CRM Segments evaluate current data

- **Status:** Implemented in Phase 4; PostgreSQL integration and authenticated UI acceptance pending.
- **Date:** 2026-09-29

## Context

Tenant CRM needs reusable audiences over Clients, preferences, Tags, typed Custom Fields, Orders, and Reservations. Phase 2 already owns the semantics for customer measures. Platform CRM has its own entity-specific field registry and Segment/filter compiler; Promotions has its own manual customer groups. Neither is the Tenant CRM domain.

## Decision

Persist a named Segment, its versioned criteria AST, tenant ownership, active state, creator, and timestamps. Do not persist member IDs, cached counts, enter/exit events, or a synchronization job. Evaluate preview, saved Segment membership, and deterministic Smart Groups in PostgreSQL through one Tenant CRM-specific bounded compiler.

The compiler accepts only server-registered field keys and type-compatible operators. It always adds tenant scope from the trusted request context; Tag and Custom Field references must resolve to active records in the same café. Every user value is a SQL parameter. Order and Reservation metrics use separate correlated aggregates so one-to-many joins cannot multiply spend or counts. Custom Field values stay in the existing validated JSONB representation and use their relational definitions and stable option IDs.

Keep Tenant CRM Segments separate from Platform CRM Segments and Promotions customer groups. Future Campaign and Analytics consumers must establish consent, eligibility, snapshot, and historical semantics before integration.

## Alternatives considered

- Persisting a SegmentMember relation and synchronizing source changes.
- Reusing Platform CRM's entity-specific Segment records or compiler.
- Reusing Promotions' manual segment model.
- Storing arbitrary SQL or filtering all Clients in the browser.
- Adding a general filter framework or new search infrastructure.

## Consequences

Membership is current and query-derived, with no historical entry/exit record. Preview and membership automatically reflect source changes. Segment evaluation does not introduce eventual-consistency jobs or duplicated member state. Correlated aggregate performance requires representative query-plan validation before production-scale optimization; the implementation's optional PostgreSQL fixture was unavailable during this phase.

Migration 1790620000000-TenantCrmSegments creates criteria-only storage with tenant-local names and a same-tenant creator reference. See SEGMENTATION.md, DATA_MODEL.md, MULTI_TENANCY.md, API.md, and TESTING.md.
