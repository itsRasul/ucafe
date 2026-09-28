# ADR-003: Reuse UCafe tenant isolation for Tenant CRM

- Status: Accepted
- Decision owner: UCafe architecture

## Context

UCafe resolves tenant context from a trusted hostname or authenticated internal proxy override and scopes tenant APIs through existing guards, memberships, and service queries. Tenant CRM will store sensitive café-customer relationship data in the shared database.

## Decision

Use the existing tenant context, tenant permission guard, and Subscription feature resolver. Every Tenant CRM query includes resolved coffeeShopId. Future relationships carry tenant scope and use composite database integrity or equivalent triggers to reject cross-tenant references.

## Alternatives

- Trust caller-supplied tenant IDs: rejected because IDs are not authorization.
- Add a second tenant framework or separate CRM database: rejected because current boundaries provide the needed authority and no evidence justifies another system.

## Consequences

Isolation tests are required for every API, bulk, import/export, analytics, and background path. Future durable work persists authoritative coffeeShopId and revalidates subject relationships.
