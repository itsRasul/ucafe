# Tenant CRM API contract

## Implemented routes

## Route behavior

- `GET /tenant/crm/clients` accepts `q`, `status`, `sortBy`, `sortOrder`, `page`, and `pageSize`. Search is limited to 100 characters; page defaults to 1, size to 50, and size is capped at 100. CRM UI requests 25 rows. Sorting is allowlisted to `createdAt` or `name`; status is `ACTIVE` or `BLOCKED`.
- A valid Iranian phone query is normalized with the existing utility and matched exactly; other queries use parameterized name substring search. SQL applies tenant scope, filters, ordering, limit, and offset.
- List response is `{ items, total, page, pageSize }`; items include `id`, `firstName`, `lastName`, masked `phone`, `status`, and `createdAt`.
- `GET /tenant/crm/clients/:clientId` scopes by both ID and resolved tenant and returns identity, full phone, status, verification time, creation time, and update time. A foreign or missing Client returns 404.
- Both routes use the administrative access token and tenant permission guard and require `tenant_crm.read` plus effective `tenant_crm`. `/tenant/admin/access` projects the effective feature for navigation.
- CRM does not expose Client creation or authentication routes. Client self-service can return a Client's own phone; the CRM list projection masks phone.

## Contract rules

- Resolve tenant from the trusted request context, never tenantId in query/body.
- Validate UUIDs and query every resource by both ID and resolved coffeeShopId.
- Enforce tenant_crm.read and tenant_crm server-side.
- Keep client self-service under existing client token routes.
- Return existing safe not-found/forbidden semantics without cross-tenant existence disclosure.
- Bound page size and query length using DTO validation. Reuse current pagination conventions.
- Keep list/search in SQL with tenant filter before pagination. Current Clients search is an existing segment service implementation; reuse primitives only if it does not couple the new module to Promotions behavior.
- DTO validation rejects unsupported status/sort values and invalid UUIDs. Feature denial uses `FEATURE_UNAVAILABLE`; permission denial follows tenant authorization; foreign/missing detail uses 404.
