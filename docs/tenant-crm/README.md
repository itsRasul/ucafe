# Tenant CRM

**Status:** Phase 1 Client Directory implemented. It uses existing Client rows and adds no CRM-owned tables.

## Purpose and boundary

Tenant CRM is the tenant-admin capability for a café to manage its relationship with its own customers. Its operators are tenant Users; its customer identity is the existing tenant-owned Client. A Client is never a User, and a person with the same phone at two cafés has separate Client records and separate histories.

This domain is separate from Platform CRM, which manages UCafe's commercial relationship with café businesses. No Platform CRM record may link to a Tenant CRM customer or its data.

## Implemented in Phase 1

- Keep Client as customer identity and source of truth; no duplicate Customer or CRM profile table was added.
- Keep Orders, Reservations, Discounts, and Tenant Analytics authoritative in their existing modules.
- Resolve tenant scope from the trusted tenant context. Every API request requires `tenant_crm.read` and effective `tenant_crm` entitlement.
- The read-only directory lives at `/admin/crm`; its list and detail APIs live at `/tenant/crm/clients`.
- Golden defaults to the feature; other plans default off. Platform Admin can change any plan with the existing plan editor. Promotions keeps its current access rules.
- Search supports names and normalized exact Iranian mobile numbers; list phone values are masked and authorized detail shows full phone.
- Reuse only domain-neutral primitives. Do not reuse Platform CRM domain records, platform permissions, filter compiler, workflow, or analytics semantics.

## Reading order

1. DOMAIN_MODEL.md
2. MULTI_TENANCY.md
3. IDENTITY.md
4. INTEGRATIONS.md
5. The feature document relevant to the change

## Documents

| Document | Purpose |
| --- | --- |
| DISCOVERY.md | Current implementation facts and conflicts |
| DOMAIN_MODEL.md | Bounded context and concepts |
| DATA_MODEL.md | Current data and future storage rules |
| MULTI_TENANCY.md | Tenant resolution, query and relationship isolation |
| IDENTITY.md | User, Client, normalization, duplicate resolution |
| INTEGRATIONS.md | Ownership and source-of-truth matrix |
| PERMISSIONS.md | Future tenant RBAC and entitlement contract |
| API.md | Implemented directory routes and API contract rules |
| UX.md | Tenant Admin placement and directory transition |
| EVENTS.md | Existing durable mechanisms and future event candidates |
| PRIVACY.md | Current facts and future privacy decisions |
| ANALYTICS.md | Existing reports and future customer measures |
| TESTING.md | Required isolation and integration coverage |
| PHASES.md | Incremental roadmap and Phase 1 contract |
| ADR-001..004 | Accepted Phase 0 architecture decisions |

## Current versus proposed

Statements about current behavior reflect code and migrations; later roadmap phases remain planned and are not implied by Phase 1.
