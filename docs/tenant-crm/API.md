# Tenant CRM API contract

## Implemented routes

## Route behavior

- `GET /tenant/crm/clients` accepts `q`, `status`, `sortBy`, `sortOrder`, `page`, and `pageSize`. Search is limited to 100 characters; page defaults to 1, size to 50, and size is capped at 100. CRM UI requests 25 rows. Sorting is allowlisted to `createdAt` or `name`; status is `ACTIVE` or `BLOCKED`.
- A valid Iranian phone query is normalized with the existing utility and matched exactly; other queries use parameterized name substring search. SQL applies tenant scope, filters, ordering, limit, and offset.
- List response is `{ items, total, page, pageSize }`; items include `id`, `firstName`, `lastName`, masked `phone`, `status`, and `createdAt`.
- `GET /tenant/crm/clients/:clientId` scopes by both ID and resolved tenant and returns identity, full phone, status, verification time, creation time, and update time. A foreign or missing Client returns 404.
- Phase 2 extends that detail response with `firstSeenAt`, `lastInteractionAt`, an `orders` summary (`trackedCount`, `deliveredCount`, `canceledCount`, `knownSpendToman`, `averageDeliveredOrderValueToman`, first/last Order creation), a `reservations` summary (total/completed/canceled/rejected/no-show counts and first/last creation), and up to five recent CRM-projected Orders and Reservations.
- `GET /tenant/crm/clients/:clientId/timeline` accepts `pageSize` (default 20, range 1–50) and an opaque `cursor`; it returns `{ items, nextCursor }`. Each item contains a globally unique `eventKey`, normalized event `type`, `occurredAt`, `sourceType`, `sourceId`, and limited CRM-relevant `metadata`. It uses strict descending `(occurredAt,eventKey)` keyset pagination. Invalid cursors return 400; a foreign/missing Client returns 404.
- Phase 2 event types cover Client creation, Order creation/current status, and Reservation creation/current status. The Timeline is a reconstructed view, not a complete historical event log; status event time is the source row's latest `status_changed_at` only.
- All routes use the administrative access token and tenant permission guard and require `tenant_crm.read` plus effective `tenant_crm`. The CRM-only source projection does not require `orders.read` or `reservations.read`, and does not expose their full module DTOs. `/tenant/admin/access` projects the effective feature for navigation.
- CRM does not expose Client creation or authentication routes. Client self-service can return a Client's own phone; the CRM list projection masks phone.

## Contract rules

### Phase 3 routes

All routes below are under `/tenant/crm`, require `tenant_crm.read`, and check the effective `tenant_crm` entitlement. Mutations also require `tenant_crm.manage`.

| Route | Behavior |
| --- | --- |
| `GET /clients/:clientId/notes?page=1&pageSize=20` | Active internal notes, bounded page size up to 100. |
| `POST /clients/:clientId/notes`, `PATCH /clients/:clientId/notes/:noteId`, `DELETE /clients/:clientId/notes/:noteId` | Create, edit, or soft-archive a note. Body is 1–4000 characters. |
| `GET/PATCH /clients/:clientId/preferences` | Read or patch the explicit built-in preference set; birthday is valid `MM-DD`. Send `null` to clear a field. |
| `GET /clients/:clientId/tags`, `POST/DELETE /clients/:clientId/tags/:tagId` | Read, idempotently assign, or remove an active tenant tag. |
| `GET/POST /tags`, `PATCH/DELETE /tags/:tagId` | List, create, rename, or soft-archive tenant tags. `includeArchived=true` includes archived definitions. |
| `GET /clients/:clientId/custom-fields`, `PATCH /clients/:clientId/custom-fields` | Read active definitions and values; atomically validate and upsert values by stable field key. `null` clears a value. Required fields are enforced when saving that Client's CRM profile, not when a definition is created. |
| `GET/POST /custom-fields`, `PATCH /custom-fields/:fieldId` | List, create, edit, reorder, activate/deactivate definitions and stable options. Field key and type cannot be changed. |
| `POST /clients/:clientId/reminders` | Create an OPEN reminder with ISO due timestamp and optional same-tenant active assignee. |
| `GET /reminders?view=TODAY|OVERDUE|UPCOMING|COMPLETED|CANCELED|ALL&clientId=:clientId&assignedToUserId=:userId&page=1&pageSize=25` | Tenant-scoped, optionally Client/assignee-filtered reminder page. A foreign Client ID returns 404. TODAY uses the tenant time zone; overdue is derived. |
| `PATCH /reminders/:reminderId` | Edit reminder metadata/assignee or transition status; completion timestamp follows COMPLETED status. |
| `GET /users` | Active, non-deleted tenant members with masked labels for reminder assignee choices; requires both read and manage permissions. |

Client and resource IDs are tenant-scoped. Foreign or archived resources are not returned as active relationships. Custom field values are checked against their active definition and active option IDs before persistence.

### General rules

- Resolve tenant from the trusted request context, never tenantId in query/body.
- Validate UUIDs and query every resource by both ID and resolved coffeeShopId.
- Enforce tenant_crm.read and tenant_crm server-side.
- Keep client self-service under existing client token routes.
- Return existing safe not-found/forbidden semantics without cross-tenant existence disclosure.
- Bound page size and query length using DTO validation. Reuse current pagination conventions.
- Keep list/search in SQL with tenant filter before pagination. Current Clients search is an existing segment service implementation; reuse primitives only if it does not couple the new module to Promotions behavior.
- DTO validation rejects unsupported status/sort values and invalid UUIDs. Feature denial uses `FEATURE_UNAVAILABLE`; permission denial follows tenant authorization; foreign/missing detail uses 404.

Phase 3 adds `NOTE_CREATED`, `REMINDER_CREATED`, and `REMINDER_COMPLETED` projection items to the Timeline. Notes never contribute their body or other free text to Timeline metadata.
