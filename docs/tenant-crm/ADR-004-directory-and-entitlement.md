# ADR-004: Place the directory in Tenant Admin and gate it by tenant_crm

- Status: Accepted
- Decision owner: UCafe product and architecture

## Context

Tenant CRM is operated by café staff. No standalone /admin/clients page exists; current customer search is embedded in Promotions manual customer segments. Plans already use an editable feature catalog and server-side effective entitlement checks.

## Decision

Phase 1 places a read-only Client directory at /admin/crm with API routes under /tenant/crm and introduces a configurable boolean tenant_crm feature in the existing plan feature system. It uses the distinct tenant permission tenant_crm.read because permission keys are globally unique and crm.read is already a Platform permission. Golden defaults enabled; other plans default disabled; Platform Admin may change any plan. The backend enforces entitlement independently from tenant RBAC. Existing Promotions customer search and manual segments remain governed by their current access rules.

## Alternatives

- Put the directory in Platform Admin: rejected because café staff are its users and client data is tenant owned.
- Add a second Clients CRUD page under Promotions: rejected because it duplicates customer management.
- Gate by plan name or reuse an unrelated feature: rejected because operators need editable plan capabilities without code changes.

## Consequences

Phase 1 adds the read-only directory, navigation, tenant permission, and feature key. The migration grants owner access and sets defaults only for plans without an explicit value. The Tenant Admin access projection and both APIs enforce the effective feature; Promotions behavior remains unchanged.
