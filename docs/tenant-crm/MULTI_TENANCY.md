# Tenant CRM multi-tenancy

## Authority

Resolve coffeeShopId through TenantContextMiddleware from the normalized request host or the authenticated internal proxy override. The API must never accept body, query, path, or header tenantId as authority. A caller-supplied identifier may at most be validated as a non-authoritative filter after authorization; the initial directory API needs no such input.

Tenant admin routes use the existing AccessTokenGuard, TenantContextGuard, and TenantPermissionGuard pattern. The guard resolves the requesting User's membership and required tenant permissions against the host-derived café.

## Query rules

- Pass resolved coffeeShopId from the request context through controller to service.
- Phase 1 list/search applies `coffee_shop_id` before status filters, ordering, limits, and offsets. Detail requires both Client ID and resolved `coffee_shop_id`.
- Every directory list, search, detail, update, bulk action, export, and aggregate includes coffeeShopId in the database query.
- Load nested records with tenant scope on both the parent and related Client. An ID alone is never authorization.
- Return not-found or the repository's established safe error for foreign tenant IDs without revealing whether the record exists elsewhere.
- Do not fetch all Clients and filter in the browser.

## Relationship integrity

Future Tenant CRM rows include both coffeeShopId and clientId and enforce same-tenant references using composite keys or database triggers consistent with the existing database patterns. Application checks remain required for useful errors and transactions; they do not replace database constraints. Apply the same rule to related segments, tags, notes, custom fields, campaign recipients, and loyalty records.

Client currently has per-café phone uniqueness. Duplicate search must query the current café only. Never build cross-tenant identity or behavioral profiles.

## Background work

Future outbox/work rows persist authoritative coffeeShopId at creation, together with stable subject IDs and a minimal event payload. Workers validate the tenant/subject relationship at execution and carry tenant scope through every read/write. They must not rely on HTTP request context or infer tenant from an untrusted mutable field.

Future bulk actions, imports, and exports use the same resolved tenant context and tenant-scoped queries. Imports validate every row and match duplicates only within that café. Exports require tenant authorization, remain bounded/auditable, and never include another café's records.

## Security test invariant

For every route or asynchronous operation, fixtures for Tenant A and Tenant B must prove that A cannot list, read, mutate, attach a nested record to, search, aggregate, import, export, or receive B's CRM data. Include random foreign IDs and deliberately mismatched database relationship writes.
