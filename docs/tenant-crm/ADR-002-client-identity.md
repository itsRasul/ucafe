# ADR-002: Use Client as Tenant CRM customer identity

- Status: Accepted
- Decision owner: UCafe product and architecture

## Context

UCafe already has a Client entity for each café's customers. It stores normalized phone identity and is referenced by Orders and Reservations. A person may be represented by distinct Client rows at multiple cafés.

## Decision

Client remains the customer identity and source of truth for Phase 1. Do not add Customer, Guest, or a supplemental CRM profile without a concrete field/lifecycle need. Keep future CRM-only records separate and tenant scoped.

## Alternatives

- Introduce a duplicate CRM customer identity: rejected because it fragments Orders, Reservations, and authentication.
- Add all future CRM data to Client: rejected as a blanket rule; only identity/profile fields belong there when justified.

## Consequences

Phase 1 duplicate resolution is exact normalized phone within one café. Names are not merge keys. Any future merge requires a separate transaction and relationship-preservation design.
