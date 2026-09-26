# ADR-007: CRM custom field storage

- **Status:** Accepted and implemented in Phase 7
- **Date:** 2026-09-27
- **Decision owner:** Platform CRM

## Context

Platform CRM needs a small, typed set of operator-defined values on Organizations, Contacts, Leads, and Deals. Filters and dynamic Segments must query those values in PostgreSQL. CRM is a platform-scoped modular-monolith domain; unrelated Plan feature metadata and tenant-owned Promotion customer segments are not CRM metadata.

## Decision

Store definitions and select options in relational tables, and store each supported record's values in a validated JSONB object. Use stable field keys and stable option UUIDs. Validate writes through the active definition and option table; reject unknown keys and wrong types. Keep core domain fields explicit and do not add generic relation, formula, or arbitrary JSON types.

## Alternatives considered

- **Typed value table:** stronger per-value constraints and more direct indexing, but adds a row lifecycle and joins for every dynamic value.
- **Generic EAV text map:** rejected because it weakens type guarantees and requires fragile casts for filters.
- **Per-field columns:** rejected because operators can add fields without schema migrations and one database column per user-defined field is not maintainable.
- **JSONB definitions and values only:** rejected because stable select-option identity, uniqueness, and option ownership need relational constraints.

## Consequences

- Migration `1790560000000-PlatformCrmFieldsTagsViewsSegments` adds one JSONB object column to each supported record table and relational field/option tables.
- Typed writes are validated by the API; the database enforces JSON object shape and definition key/type/uniqueness constraints.
- Server filtering binds user values and the JSONB key. No index is added for every custom field. Tag assignments use explicit entity FKs and indexes.
- Label changes do not alter stored option IDs. Inactive and archived values remain readable. Required fields are enforced only when included in PATCH, allowing historical records to remain temporarily incomplete.
- Custom-field sorting, arbitrary nested filters, and query-time Subscription lifecycle projections are deferred until a measured need and safe owner-module query contract exist.

## Revisit when

Representative CRM volumes show JSONB filtering cannot meet the list/Segment latency target, or an owner-module query projection can expose effective customer context without duplicating Subscription lifecycle rules. At that point, compare expression/GIN indexes with a typed value table using measured query plans.
