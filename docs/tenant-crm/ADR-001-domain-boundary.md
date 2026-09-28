# ADR-001: Keep Tenant CRM separate from Platform CRM

- Status: Accepted
- Decision owner: UCafe product and architecture

## Context

Platform CRM manages UCafe's business relationship with café tenants. Tenant CRM will manage each café's relationship with its own Clients. They have different actors, data ownership, permissions, and tenant boundaries.

## Decision

Keep Tenant CRM a separate bounded context inside the existing modular monolith. Do not combine the domains in a generic crm module and do not create relationships between Platform CRM records and tenant customer records.

## Alternatives

- Reuse Platform CRM domain objects: rejected because those represent UCafe sales concepts and platform scope.
- Split Tenant CRM into a new service/database: rejected because no measured security or scaling need justifies new infrastructure.

## Consequences

Future Tenant CRM uses tenant RBAC and tenant feature entitlement. Domain-neutral utilities may be reused after checking their contracts. Platform CRM changes are not required.
