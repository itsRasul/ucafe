# Tenant CRM multi-tenancy

## Authority

Resolve coffeeShopId through TenantContextMiddleware from the normalized request host or the authenticated internal proxy override. The API must never accept body, query, path, or header tenantId as authority. A caller-supplied identifier may at most be validated as a non-authoritative filter after authorization; the initial directory API needs no such input.

Tenant admin routes use the existing AccessTokenGuard, TenantContextGuard, and TenantPermissionGuard pattern. The guard resolves the requesting User's membership and required tenant permissions against the host-derived café.

## Query rules

- Pass resolved coffeeShopId from the request context through controller to service.
- Phase 1 list/search applies `coffee_shop_id` before status filters, ordering, limits, and offsets. Detail requires both Client ID and resolved `coffee_shop_id`.
- Phase 2 Customer 360 aggregate and recent Orders/Reservations queries constrain both `coffee_shop_id` and `client_id`; each Timeline `UNION ALL` branch constrains the same resolved tenant and Client. Client existence is first checked with both IDs. Cursor values are validated and parameterized; they never supply tenant scope.
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

**Phase 3 integrity.**

Notes, profiles, Client-Tag assignments, Custom Field values, and Reminders carry the tenant key and use composite foreign keys to the matching Client. Tags, field definitions/options, and actor/assignee memberships are tenant-local. Active tag names are unique per tenant, while the same name may exist in multiple tenants. Every service query also scopes reads and writes by the current tenant. Database tests verify same-name tags across tenants and reject cross-tenant Client, Tag, field, and membership references.

For every route or asynchronous operation, fixtures for Tenant A and Tenant B must prove that A cannot list, read, mutate, attach a nested record to, search, aggregate, import, export, or receive B's CRM data. Include random foreign IDs and deliberately mismatched database relationship writes.

## Phase 4 Segment evaluation

Each saved Segment is tenant-owned and constrained by a coffee_shop_id foreign key plus unique (coffee_shop_id,id). Its creator must be a membership of that same tenant. List, detail, update, preview, and member routes use the resolved coffeeShopId; a foreign Segment UUID behaves as not found.

Every draft, saved, and Smart Group evaluation begins with the current Tenant's clients and an injected, parameterized coffee_shop_id predicate. Tenant identity is not a field or AST value. Tag and Custom Field definitions/options come from the same tenant's active catalog; Tag assignments and Custom Field value EXISTS predicates are additionally correlated to the Client's coffee_shop_id and ID. No Client ID membership list is shared or persisted.

The PostgreSQL isolation fixture includes two cafés with identical Tag names and qualifying customer data, tests a foreign Tag reference, and checks that membership stays tenant-scoped after source data changes.

## Phase 6 Feedback isolation

Every Feedback list/detail/write and Customer 360 aggregate/recent query includes the resolved `coffee_shop_id`; Client references additionally match `client_id`. Customer submissions use the authenticated Client principal rather than a request-supplied identity. An Order or Reservation link must match the trusted tenant and same Client and must be `DELIVERED` or `COMPLETED`, respectively. Composite foreign keys independently enforce both tenant and Client identity. Customer response lookups filter tenant, authenticated Client, and linked source. Service recovery mutations lock and update by tenant plus Feedback ID; resolver membership must belong to that tenant. Platform CRM has no route or relation to this table.

## Phase 5 Loyalty isolation

Every Program, Account, Reward, Redemption, Ledger entry, and outbox event carries `coffee_shop_id`. Composite foreign keys require the same café for Client, Account/Client, Reward, Order, Redemption, and membership actor relationships. Every API lookup includes the trusted Tenant context; a foreign Client or Reward behaves as not found. Same-phone Clients in two cafés retain independent account rows and ledger sums. Background earning also derives tenant and Client from the delivered Order row and uses the event's tenant-scoped aggregate ID.


## Phase 7 Offer isolation

Offer, Segment, Promotion, Client, and membership reads carry coffee_shop_id predicates. Composite foreign keys enforce same-tenant references in the database. Activation locks the Draft Offer and active Segment, compiles the shared Segment evaluator with the current tenant catalog, and inserts its audience using one set-based statement in the same transaction as the Offer state and Segment snapshots.
