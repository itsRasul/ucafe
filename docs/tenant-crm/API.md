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

Phase 6 extends `GET /tenant/crm/clients/:clientId` with a tenant/Client-scoped Feedback summary and at most five recent Feedback rows. The summary contains count, one-decimal average rating, negative count (`rating <= 2`), current Needs Attention count, and latest Feedback timestamp. Timeline projects `FEEDBACK_RECEIVED` and `FEEDBACK_RESOLVED` with stable UUID-based keys; metadata includes rating/source but no free text.

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

## Phase 4 Segmentation routes

All routes below require tenant_crm.read and effective tenant_crm entitlement. Create/update require tenant_crm.manage. Tenant scope is host/context-derived, never supplied by a request field.

| Route | Contract |
| --- | --- |
| GET /tenant/crm/segments/fields | Active allowlisted field metadata and active same-tenant Tag/Custom Field options. |
| GET /tenant/crm/segments?page=1&pageSize=25&q= | Paged case-insensitive substring search over saved Segment names; returns criteria plus criteriaValid and, when needed, criteriaIssue. |
| POST /tenant/crm/segments/preview | Body is {criteria}; validates and evaluates unsaved criteria; returns matchingClients and up to five masked Client samples. |
| POST /tenant/crm/segments | Body has name, optional description, and criteria; returns the created tenant-owned Segment. A case-insensitive name conflict returns 409 with TENANT_CRM_SEGMENT_NAME_IN_USE. |
| GET /tenant/crm/segments/:segmentId | Read a tenant-owned Segment. |
| PATCH /tenant/crm/segments/:segmentId | Optionally updates name, description, criteria, or isActive. Omitting criteria preserves it; this allows metadata/status repair while archived criteria remain invalid. |
| GET /tenant/crm/segments/:segmentId/preview | Re-evaluates current saved criteria and returns matchingClients plus up to five masked samples. |
| GET /tenant/crm/segments/:segmentId/clients?page=1&pageSize=25 | Re-evaluates criteria and returns a tenant-scoped member page as {items,total,page,pageSize}. |
| GET /tenant/crm/smart-groups | Returns fixed system preset keys, labels, descriptions, and AST definitions. |
| GET /tenant/crm/smart-groups/:key/preview | Preview current membership for a known preset. |
| GET /tenant/crm/smart-groups/:key/clients?page=1&pageSize=25 | Return one server-paginated preset member page. |

Page is a positive integer, pageSize is 1–100, list q is at most 100 characters, names are 1–120 characters, and descriptions are at most 500 characters. Criteria are version 1 typed groups, at most three levels, 20 conditions, 20 children per group, 100 selected values, 3,650 relative days, and 6,000 serialized characters. Unknown fields/operators and inactive or cross-tenant references return 400 before evaluation. Invalid UUIDs use the existing UUID pipe; missing or foreign Segment IDs return 404. Unknown Smart Group keys return 404. The database unique-name constraint maps to the 409 conflict. Feature denial follows existing FEATURE_UNAVAILABLE behavior; permission denial follows TenantPermissionGuard.

The compiler parameterizes values and injects tenant scope. Preview, saved membership, and Smart Groups share it. Membership is current query output; endpoints do not expose historical entry/exit transitions, and inactive status does not create or freeze a member list.

## Phase 6 Feedback routes

Tenant Admin Feedback routes require effective `tenant_crm` and `tenant_crm.read`; mutations also require `tenant_crm.manage`.

| Method and route | Behavior |
| --- | --- |
| `GET /tenant/crm/feedback` | Server-paginated inbox. Supports `q`, `clientId`, `status`, `rating`, `source`, `dateFrom`, `dateTo`, allowlisted `sortBy=createdAt|rating|updatedAt`, `sortOrder=asc|desc`, `page`, and `pageSize` (max 100). Dates use café timezone. Search covers Client name, normalized exact Iranian phone, and comment; list phone is masked. |
| `POST /tenant/crm/feedback` | Manual entry `{ clientId, rating, comment? }`; creator comes from authenticated staff identity. |
| `GET /tenant/crm/feedback/:feedbackId` | Staff detail including internal resolution fields; foreign/missing ID returns 404. |
| `POST /tenant/crm/feedback/:feedbackId/needs-attention` | Marks a NEW item for follow-up. Resolved items cannot reopen. |
| `POST /tenant/crm/feedback/:feedbackId/resolve` | Resolves with optional `{ resolutionNote }`; repeated resolve preserves first resolution. |
| `GET /public/client-panel/feedback/orders/:orderId` | Returns the authenticated Client's own response, if any, with rating/comment/source/time only. |
| `GET /public/client-panel/feedback/reservations/:reservationId` | Same limited response projection for the authenticated Client's Reservation. |
| `POST /public/client-panel/feedback` | Client-authenticated `{ rating, comment?, orderId?, reservationId? }`; exactly one completed same-tenant/same-Client Order or Reservation is required. One response per source record. |

Ratings are required integers 1–5. Ratings 1–2 start at `NEEDS_ATTENTION`; ratings 3–5 start at `NEW`. Customer panel accepts only `DELIVERED` Orders and `COMPLETED` Reservations. Feedback source is `MANUAL` or `CUSTOMER_PANEL`; duplicate linked sources return 409. Client IDs and tenant IDs are never accepted from customer input. Recovery status, resolution notes, and staff identities never appear in Client responses.

## Phase 5 Loyalty routes

| Method and route | Behavior |
| --- | --- |
| `GET /tenant/crm/loyalty/program` | Return current configuration or an unconfigured/disabled projection. |
| `PATCH /tenant/crm/loyalty/program` | Append an enabled/rate version; unchanged values do not create history. |
| `GET /tenant/crm/loyalty/rewards?page=1&pageSize=20` | Return a tenant-paginated catalog, including inactive records for managers. |
| `POST /tenant/crm/loyalty/rewards` | Create a same-café Reward. |
| `PATCH /tenant/crm/loyalty/rewards/:rewardId` | Edit or activate/deactivate a Reward; no delete route exists. |
| `GET /tenant/crm/clients/:clientId/loyalty` | Return derived balance, active reward eligibility, five recent ledger rows/redemptions, and ledger total. |
| `GET /tenant/crm/clients/:clientId/loyalty/ledger?page=1&pageSize=20` | Return bounded ledger history, total, and the current derived balance. |
| `POST /tenant/crm/clients/:clientId/loyalty/adjust` | Append a reasoned credit/debit using `direction`, positive integer `points`, and required idempotency key. |
| `POST /tenant/crm/clients/:clientId/loyalty/redeem` | Record a same-café active Reward redemption with an idempotency key. |

All Loyalty reads require `tenant_crm.read` plus effective `tenant_crm`; mutations additionally require `tenant_crm.manage`. Page is positive and pageSize is 1–100. Spend threshold, reward cost, and adjustment amount are positive integers bounded to 1,000,000,000; reasons are required and at most 500 characters; idempotency keys are 8–120 safe ASCII characters. Invalid UUIDs use `ParseUUIDPipe`; foreign Client/Reward IDs are not found. Manual debit/redemption that would make balance negative return `LOYALTY_INSUFFICIENT_POINTS`; blocked Clients cannot mutate points; disabled Programs reject earning/redemption while retaining history.


## Phase 7 Offers routes

- GET /tenant/crm/offers with status, q, page, and pageSize filters; GET /tenant/crm/offers/:offerId.
- POST /tenant/crm/offers/preview accepts a saved Segment ID and returns the existing evaluator's count and masked sample.
- POST /tenant/crm/offers creates a Draft; PATCH /tenant/crm/offers/:offerId edits a Draft.
- POST /tenant/crm/offers/:offerId/activate snapshots the current audience; POST /tenant/crm/offers/:offerId/end ends an active Offer.
- GET /tenant/crm/offers/:offerId/clients and GET /tenant/crm/clients/:clientId/offers return bounded pages.
- Access requires tenant_crm.read, menu.read, and the tenant_crm feature. Mutations also require tenant_crm.manage.
