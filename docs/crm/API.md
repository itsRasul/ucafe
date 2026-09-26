# Platform CRM API

Phase 1 API is implemented under `/api/v1/platform/crm`. Every route uses `AccessTokenGuard` and `PlatformPermissionGuard`. Resource IDs are UUID-validated, request DTOs use the global whitelist/forbid/transform validation pipe, and results use parameterized SQL.

## Implemented routes

~~~text
GET    /api/v1/platform/crm/organizations
POST   /api/v1/platform/crm/organizations
GET    /api/v1/platform/crm/organizations/duplicate-candidates
GET    /api/v1/platform/crm/organizations/:organizationId
PATCH  /api/v1/platform/crm/organizations/:organizationId
POST   /api/v1/platform/crm/organizations/:organizationId/archive
POST   /api/v1/platform/crm/organizations/:organizationId/restore

GET    /api/v1/platform/crm/organizations/:organizationId/contacts
POST   /api/v1/platform/crm/organizations/:organizationId/contacts
GET    /api/v1/platform/crm/organizations/:organizationId/contacts/duplicate-candidates
GET    /api/v1/platform/crm/contacts
GET    /api/v1/platform/crm/contacts/:contactId
PATCH  /api/v1/platform/crm/contacts/:contactId
POST   /api/v1/platform/crm/contacts/:contactId/archive
POST   /api/v1/platform/crm/contacts/:contactId/restore

GET    /api/v1/platform/crm/tenant-link-candidates
~~~

There is no CRM `DELETE` route. The public consultation intake and its platform inbox routes are unchanged. Lead, Deal, Task, Activity, conversion, and timeline endpoints remain deferred to their roadmap phases.

## Organizations

Create and patch accept `name`, optional `city`, `website`, `instagram`, and optional `coffeeShopId`. The Tenant link is unique per Organization/Tenant and is validated against a non-deleted Tenant. CRM returns a read-only linked Tenant name/status projection. Candidate Tenant listing requires both `crm.read` and `tenants.read`.

The organization list returns `{ items, total, page, pageSize }`, with page default `1`, pageSize default `25` and maximum `100`. Filters are `q`, exact normalized `city`, `coffeeShopId`, `tenantLink=LINKED|UNLINKED`, and `archiveStatus=ACTIVE|ARCHIVED|ALL` (default `ACTIVE`). Sort is allowlisted to `createdAt|name|city` and direction to `ASC|DESC`; ID is the stable tie-breaker. Search covers name, city, website, and Instagram handle.

`GET /organizations/duplicate-candidates` accepts `name`, `city`, `website`, `instagram`, and optional `excludeId`. It returns exact name+city, website-host, and Instagram matches with matching field names. Active and archived candidates are included. Matches are warnings only; CRM never auto-merges or blocks two Organizations with the same business name.

## Contacts

Contacts are created only through their Organization route and cannot be moved between Organizations in Phase 1. The `contacts` list also accepts `organizationId`, `q`, `archiveStatus`, `page`, `pageSize`, `sort`, and `direction`. Search uses partial name/role text and exact normalized phone/email hashes. List items omit decrypted phone and email; the authorized single-contact detail used by edit returns those values.

`GET /organizations/:organizationId/contacts/duplicate-candidates` accepts `phone`, `email`, and optional `excludeId`. It checks exact keyed hashes within that Organization and returns matching field names and Contact names/roles, never the matched values or hashes. The UI lets an operator continue after reviewing candidates; no records are automatically merged.

The Tenant-link candidate endpoint returns the first 100 unlinked, non-deleted Tenants in name order, plus the Organization's current linked Tenant when an Organization ID is supplied. This keeps the initial form selector bounded; add query search or pagination if the active Tenant count outgrows the list.

Iranian Contact mobile numbers use the existing UCafe normalizer. Email is trimmed and lowercased. Both are encrypted with the existing AES-256-GCM key; keyed HMAC hashes support exact lookup. Phone/email are not included in audit summaries or list projections.

## Errors and archive behavior

Use standard Nest status behavior: 400 invalid input, 401 missing/invalid authentication, 403 missing permission, 404 missing Organization/Contact/Tenant, and 409 a Tenant link collision or update attempted on an archived record. Archive/restore are idempotent, preserve related records, and are audited with PII-free summaries. Archived rows stay readable for restore; list filters default to active rows. Archiving an Organization does not archive its Contacts, and no parent delete cascades.
