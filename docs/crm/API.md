# Platform CRM API

Phase 1 and Phase 2 APIs are implemented under `/api/v1/platform/crm`. Every route uses `AccessTokenGuard` and `PlatformPermissionGuard`. Resource IDs are UUID-validated, request DTOs use the global whitelist/forbid/transform validation pipe, and results use parameterized SQL.

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

GET    /api/v1/platform/crm/leads
GET    /api/v1/platform/crm/leads/assignees
POST   /api/v1/platform/crm/leads/duplicate-candidates
POST   /api/v1/platform/crm/leads
GET    /api/v1/platform/crm/leads/:leadId
PATCH  /api/v1/platform/crm/leads/:leadId
POST   /api/v1/platform/crm/leads/:leadId/status
POST   /api/v1/platform/crm/leads/:leadId/qualify
POST   /api/v1/platform/crm/leads/:leadId/unqualify
POST   /api/v1/platform/crm/leads/:leadId/convert
POST   /api/v1/platform/crm/leads/:leadId/archive
POST   /api/v1/platform/crm/leads/:leadId/restore
~~~

There is no CRM `DELETE` route. Public consultation intake still uses its existing routes; accepted submissions now create a Lead transactionally. Deal, Task, Activity, and timeline endpoints remain deferred.

## Organizations

Create and patch accept `name`, optional `city`, `website`, `instagram`, and optional `coffeeShopId`. The Tenant link is unique per Organization/Tenant and is validated against a non-deleted Tenant. CRM returns a read-only linked Tenant name/status projection. Candidate Tenant listing requires both `crm.read` and `tenants.read`.

The organization list returns `{ items, total, page, pageSize }`, with page default `1`, pageSize default `25` and maximum `100`. Filters are `q`, exact normalized `city`, `coffeeShopId`, `tenantLink=LINKED|UNLINKED`, and `archiveStatus=ACTIVE|ARCHIVED|ALL` (default `ACTIVE`). Sort is allowlisted to `createdAt|name|city` and direction to `ASC|DESC`; ID is the stable tie-breaker. Search covers name, city, website, and Instagram handle.

`GET /organizations/duplicate-candidates` accepts `name`, `city`, `website`, `instagram`, and optional `excludeId`. It returns exact name+city, website-host, and Instagram matches with matching field names. Active and archived candidates are included. Matches are warnings only; CRM never auto-merges or blocks two Organizations with the same business name.

## Contacts

Contacts are created only through their Organization route and cannot be moved between Organizations in Phase 1. The `contacts` list also accepts `organizationId`, `q`, `archiveStatus`, `page`, `pageSize`, `sort`, and `direction`. Search uses partial name/role text and exact normalized phone/email hashes. List items omit decrypted phone and email; the authorized single-contact detail used by edit returns those values.

`GET /organizations/:organizationId/contacts/duplicate-candidates` accepts `phone`, `email`, and optional `excludeId`. It checks exact keyed hashes within that Organization and returns matching field names and Contact names/roles, never the matched values or hashes. The UI lets an operator continue after reviewing candidates; no records are automatically merged.

The Tenant-link candidate endpoint returns the first 100 unlinked, non-deleted Tenants in name order, plus the Organization's current linked Tenant when an Organization ID is supplied. This keeps the initial form selector bounded; add query search or pagination if the active Tenant count outgrows the list.

Iranian Contact mobile numbers use the existing UCafe normalizer. Email is trimmed and lowercased. Both are encrypted with the existing AES-256-GCM key; keyed HMAC hashes support exact lookup. Phone/email are not included in audit summaries or list projections.

## Leads

Every Lead route requires `crm.read` for reads and duplicate candidates, or `crm.manage` for create/update/status/qualification/conversion/archive/restore. `assignees` lists active platform Users with CRM access and returns masked labels. Lead phone/email are encrypted at rest; only authorized single-Lead detail and mutation projections include decrypted values. Lists, duplicate candidates, and audit summaries omit them. Duplicate candidate checks use POST so PII is not placed in the URL.

Create accepts `businessName`, optional `contactName`, `phone`, `email`, `city`, `website`, `instagram`, and `description`, required code-defined `source`, optional `priority`, `ownerId`, `organizationId`, `primaryContactId`, and `allowPotentialDuplicates`. Phone uses the existing Iranian mobile normalizer. Owner must be an active platform User with `crm.read` or `crm.manage`. A Contact must belong to the selected Organization; when only a Contact is selected its Organization is inferred. An unassigned Lead is allowed.

Lead list returns `{ items, total, page, pageSize }` (defaults 1/25, maximum pageSize 100). Filters are `q`, `status`, `source`, `priority`, `ownerId` (UUID or `UNASSIGNED`), `organizationId`, exact normalized `city`, and `archiveStatus=ACTIVE|ARCHIVED|ALL` (default `ACTIVE`). Sort is allowlisted to `createdAt|updatedAt|priority|status`, with `ASC|DESC` direction and stable ID tie-breaker. Search covers business/contact/city/linked Organization text and exact normalized phone/email matches; results omit contact PII.

`POST /leads/duplicate-candidates` accepts prospect identity fields as create, plus optional `excludeId`. Exact matching covers business name + city, website host, Instagram handle, phone/email hashes against CRM Contacts and Leads. Candidates include record type, IDs, display names, status where relevant, and matching field keys; no automatic merge occurs. Create/update return HTTP 409 with `{ message, candidates }` when candidates exist unless the request explicitly sets `allowPotentialDuplicates: true`. An operator may instead link an Organization or Contact. Archived candidates are included for review.

PATCH updates the Lead snapshot, priority, owner, and canonical links. Converted Leads are immutable except archive/restore. Status POST only permits ordinary lifecycle transitions; `qualify` is accepted only from CONTACTED/NURTURING and can set `qualificationNotes`; `unqualify` is accepted only from eligible open states and requires a reason, with optional detail for OTHER. All status operations lock the Lead and append history in the same transaction.

Conversion accepts `{ organizationMode: "CREATE"|"LINK", organizationId?, contactMode: "CREATE"|"LINK", contactId?, confirmPotentialDuplicates? }`. A qualified Lead must resolve/create an Organization and a Contact within it. A new Contact uses the Lead's contact name and encrypted phone/email; if the name is missing, link an existing Contact or edit the Lead before conversion. Duplicate Organization or Contact candidates return 409 unless the operator explicitly confirms creating a separate record. Conversion locks the Lead; links, CONVERTED state/timestamp, status history, and audit record commit atomically. Repeating conversion returns the existing converted Lead and does not create records again. No Deal is created.

Archive/restore preserve the Lead, status history, source request, and Organization/Contact links. Archived Leads remain readable and may be listed with `ARCHIVED` or `ALL`; restore is required before editing or status changes.

## Errors and archive behavior

Use standard Nest status behavior: 400 invalid input, 401 missing/invalid authentication, 403 missing permission, 404 missing Organization/Contact/Tenant, and 409 a Tenant link collision or update attempted on an archived record. Archive/restore are idempotent, preserve related records, and are audited with PII-free summaries. Archived rows stay readable for restore; list filters default to active rows. Archiving an Organization does not archive its Contacts, and no parent delete cascades.
