# ADR-005: Store validated custom field values as typed JSONB

## Context

Each café can define different Client fields, while future Segmentation needs deterministic types and stable select identifiers. A schema column per user-defined field is not viable; an untyped key/string EAV table would weaken validation and query semantics.

## Decision

Store tenant-owned field definitions and select options relationally. Store each Client/definition value as one JSONB scalar or array, validate the value against the active definition and stable option UUIDs in the Tenant CRM service, and constrain the value row to the same tenant, Client, definition, and editor with composite foreign keys. The field type and key are immutable; options retain UUIDs when labels change and may be deactivated.

## Consequences

The database can index and scope records by tenant, Client, and definition while the service enforces the domain-specific JSON type. This does not yet provide optimized cross-client predicates for Segmentation. Add typed expression indexes or a relational value representation only when Phase 4 query patterns and representative data justify them; keep the service validator as the write boundary.
