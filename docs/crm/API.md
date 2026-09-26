# Platform CRM API

Phases 1–7 APIs are implemented under `/api/v1/platform/crm`. Every route uses `AccessTokenGuard` and `PlatformPermissionGuard`. Resource IDs are UUID-validated, request DTOs use the global whitelist/forbid/transform validation pipe, and results use parameterized SQL.

## Implemented routes

~~~text
GET    /api/v1/platform/crm/organizations
POST   /api/v1/platform/crm/organizations
GET    /api/v1/platform/crm/organizations/duplicate-candidates
GET    /api/v1/platform/crm/organizations/:organizationId
GET    /api/v1/platform/crm/organizations/:organizationId/overview
GET    /api/v1/platform/crm/organizations/:organizationId/timeline
GET    /api/v1/platform/crm/organizations/:organizationId/customer-context
PATCH  /api/v1/platform/crm/organizations/:organizationId
POST   /api/v1/platform/crm/organizations/:organizationId/tenant-link
DELETE /api/v1/platform/crm/organizations/:organizationId/tenant-link
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

Phase 4 work routes:

~~~text
GET    /api/v1/platform/crm/activities
POST   /api/v1/platform/crm/activities
GET    /api/v1/platform/crm/activities/:activityId
PATCH  /api/v1/platform/crm/activities/:activityId
POST   /api/v1/platform/crm/activities/:activityId/archive
POST   /api/v1/platform/crm/activities/:activityId/restore

GET    /api/v1/platform/crm/tasks
POST   /api/v1/platform/crm/tasks
GET    /api/v1/platform/crm/tasks/:taskId
PATCH  /api/v1/platform/crm/tasks/:taskId
POST   /api/v1/platform/crm/tasks/:taskId/complete
POST   /api/v1/platform/crm/tasks/:taskId/cancel
POST   /api/v1/platform/crm/tasks/:taskId/reopen
POST   /api/v1/platform/crm/tasks/:taskId/archive
POST   /api/v1/platform/crm/tasks/:taskId/restore

GET    /api/v1/platform/crm/notes
POST   /api/v1/platform/crm/notes
GET    /api/v1/platform/crm/notes/:noteId
PATCH  /api/v1/platform/crm/notes/:noteId
POST   /api/v1/platform/crm/notes/:noteId/archive
POST   /api/v1/platform/crm/notes/:noteId/restore
~~~

There is no CRM `DELETE` route. Public consultation intake keeps its existing contract; accepted submissions create a Lead transactionally.

### Organization overview and Timeline (Phase 5)

`GET /organizations/:organizationId/overview` requires `crm.read` and composes existing CRM tables into a bounded Organization 360 response. It returns `summary` (active Contact count, linked Lead count, active Deal count, active OPEN Deal count, open Task count, latest active Activity, and next open Task), up to six recent `leads`, six recent `deals`, six `openTasks`, six `recentActivities`, six `recentNotes`, and `sectionErrors`. Summary count fields are `null` if their query fails; a failed preview section is named in `sectionErrors` while other sections remain available. Contact details continue to come from the existing paginated Contacts endpoint.

`GET /organizations/:organizationId/timeline` requires `crm.read` and `subscriptions.read` and returns `{ items, total, page, pageSize }`; defaults are page `1` and pageSize `20`, maximum `100`. Optional filters are `category=LEAD|DEAL|ACTIVITY|TASK|NOTE|CUSTOMER`, `dateFrom`, and `dateTo` (ISO-8601 timestamps; lower bound inclusive, upper bound exclusive). The UI's native date controls convert the selected local days to ISO timestamp boundaries. Items use stable IDs/types, source occurrence time, actor projection, source/related record IDs, localized-at-render-time metadata, and current source text where the source has no edit history. Results are ordered by `occurredAt DESC, category ASC, id ASC`. Offset pagination is stable for an unchanged result set; concurrent inserts can shift offsets. No entire-history load or Timeline write endpoint exists.

Example:

~~~http
GET /api/v1/platform/crm/organizations/8f6252a7-2b68-4e0e-b0c4-5b8896e7eaab/timeline?category=TASK&dateFrom=2026-09-01T00%3A00%3A00.000Z&page=1&pageSize=20
~~~

The Timeline includes Lead creation/status, Deal creation/stage/outcome, Activity creation, Task creation/completion/cancellation/reopen, Note creation, Tenant creation and explicit CRM link/unlink, Trial start, and successful paid Subscription operations. Customer facts are source-backed and read-only; status changes without durable transition history are not fabricated. Customer events require `subscriptions.read`. Task lifecycle attribution uses only transactional `crm.task.completed|canceled|reopened` audit records; Deal outcome time/status comes from the Deal row and the matching audit action supplies its actor. See [TIMELINE.md](TIMELINE.md) for association, archive, and timestamp details.

## Organizations

Create and patch accept `name`, optional `city`, `website`, and `instagram`; Tenant identity is not accepted as a profile field. `POST /organizations/:organizationId/tenant-link` accepts `{ "coffeeShopId": "<uuid>" }` and requires `crm.manage` plus `tenants.read`. `DELETE` on the same route clears only the CRM link under the same permissions. Both actions are transactional, audited, and idempotent. The unique Organization/Tenant relationship is validated against a non-deleted Tenant. Candidate listing requires `crm.read` and `tenants.read` and returns bounded Tenant choices with name, slug, status, and active primary hostname.

`GET /organizations/:organizationId/customer-context` requires `crm.read` and `subscriptions.read`. It returns the linked Tenant's current name, slug, status, active primary hostname, and durable lifecycle timestamps plus a narrow read-only Subscription projection (effective status, current/pending Plan, Trial state/dates, current period, and grace window). It omits payment amounts, provider references, invoice intents, owner membership/contact data, and plan feature configuration. It does not reconcile or mutate state. Existing CRM Organizations remain valid without a Tenant; archived Organizations cannot be linked, and unlinking never changes or deletes the Tenant.

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

## Deals and pipeline

Every Deal route requires `crm.read` for reads/options or `crm.manage` for writes. `GET /pipeline` returns the single code-defined `ucafe-default` pipeline, ordered stage metadata, and active OPEN per-stage counts and estimated Toman totals. `GET /deal-plans` returns active Plan options as read-only references.

Routes:

~~~text
GET    /api/v1/platform/crm/deals
POST   /api/v1/platform/crm/deals
GET    /api/v1/platform/crm/deals/:dealId
PATCH  /api/v1/platform/crm/deals/:dealId
POST   /api/v1/platform/crm/deals/:dealId/stage
POST   /api/v1/platform/crm/deals/:dealId/win
POST   /api/v1/platform/crm/deals/:dealId/lose
POST   /api/v1/platform/crm/deals/:dealId/archive
POST   /api/v1/platform/crm/deals/:dealId/restore
GET    /api/v1/platform/crm/pipeline
GET    /api/v1/platform/crm/deal-plans
~~~

Create requires `title` and `organizationId`; optional fields are `primaryContactId`, `originatingLeadId`, `ownerId`, `expectedPlanId`, `stage`, `estimatedAmountToman`, and `expectedCloseDate`. A lead origin must be qualified or converted and already linked to the selected Organization; a Lead can originate at most one Deal. Contact must belong to the Organization. Owner must be an active CRM-assigned platform user. Updates can change title, contact, owner, expected Plan, estimate, and expected close date; Organization, originating Lead, pipeline, and stage are immutable through PATCH.

List returns `{ items, total, page, pageSize, stageTotals }`; supports `q`, `status`, `stage`, `ownerId` (UUID or `UNASSIGNED`), `organizationId`, `expectedPlanId`, `expectedCloseFrom`, `expectedCloseTo`, archive state, allowlisted sort/direction, and 1-based pagination (maximum 100 rows). Search covers Deal title, Organization, and primary Contact. Stage totals reflect the active filtered OPEN set.

Stage POST accepts `{ expectedStage, stage, reason? }` and rejects stale concurrent moves. Adjacent forward moves need no reason; skipped/backward moves require a nonblank explanation. Initial creation records the selected starting stage. Win and loss are explicit outcomes; loss accepts a controlled `reason` and optional `detail` only for OTHER. Closed Deals cannot be edited, moved, or reopened. Each consequential state write, stage history, and PII-free audit record share a transaction.

Deal estimates are integer Toman strings at API boundaries and forecasts only. Selecting an expected Plan does not enroll a Tenant or mutate its Trial, Subscription, invoice, or Payment.

Archive/restore preserve the Lead, status history, source request, and Organization/Contact links. Archived Leads remain readable and may be listed with `ARCHIVED` or `ALL`; restore is required before editing or status changes.

## Activities, Tasks, and Notes

All Phase 4 reads require `crm.read`; creates, edits, lifecycle changes, and archive/restore require `crm.manage`. Lists use 1-based pagination (`page` default 1, `pageSize` default 25, maximum 100) and `archiveStatus=ACTIVE|ARCHIVED|ALL` (default `ACTIVE`). Returned actor/assignee names use masked labels.

Every work record must reference at least one Organization, Contact, Lead, or Deal. Multiple references are allowed only within one Organization. A Lead-only record is valid before conversion; its Organization list projection resolves through the converted Lead. CRM details that are archived cannot receive new or changed work. Database foreign keys and same-Organization composite constraints back the service validation. Audit rows are written transactionally and never contain Activity subjects/details, Task titles/descriptions, or Note bodies.

- **Activities:** create/update accepts `activityType`, `subject`, optional `details`, `occurredAt`, optional `outcome`, and association IDs. Types are `CALL|MEETING|DEMO|EMAIL|SMS|WHATSAPP|OTHER`; only Calls and Meetings/Demos accept outcomes, from their type-specific sets. Future `occurredAt` values are rejected. List filters include text, type, outcome, actor, associated IDs, occurred range, archive state, sort (`occurredAt|createdAt`) and direction.
- **Tasks:** create/update accepts `title`, optional `description`, `kind` (`GENERAL|FOLLOW_UP`), `priority` (`LOW|NORMAL|HIGH|URGENT`), `dueAt`, `assignedToUserId`, and association IDs. Assignees must be active platform Users with CRM access. List filters include text, status, priority, kind, assignee (`ME`, `UNASSIGNED`, or UUID), views (`OPEN|OVERDUE|UPCOMING|COMPLETED|CANCELED|NO_DUE_DATE`), association IDs, due range, sort, direction, and archive state. `OVERDUE` is derived from OPEN plus a due time before database now; it is never stored. `dueFrom` is inclusive and `dueTo` exclusive. Complete/cancel set status, timestamp, and actor together; reopening clears prior terminal metadata. OPEN Tasks cannot be archived.
- **Notes:** create/update accepts a plain-text `body` and association IDs. List filters include association IDs, archive state, sort (`createdAt|updatedAt`) and direction. Notes have no hard-delete route.

Completing a Task does not create an Activity. Follow-up quick actions create a regular Task with kind `FOLLOW_UP`; Phase 5 exposes the selected CRM histories and work records through a read-only Organization Timeline. It does not schedule reminders or include Tenant, Subscription, or Payment events.

## Phase 7 metadata, saved views, and Segments

~~~text
GET    /api/v1/platform/crm/custom-fields?entityType=ORGANIZATION&includeInactive=false
POST   /api/v1/platform/crm/custom-fields
GET    /api/v1/platform/crm/custom-fields/:id
PATCH  /api/v1/platform/crm/custom-fields/:id
POST   /api/v1/platform/crm/custom-fields/:id/archive
GET    /api/v1/platform/crm/records/:entityType/:recordId/custom-fields
PATCH  /api/v1/platform/crm/records/:entityType/:recordId/custom-fields
GET    /api/v1/platform/crm/tags
POST   /api/v1/platform/crm/tags
PATCH  /api/v1/platform/crm/tags/:id
POST   /api/v1/platform/crm/tags/:id/archive
GET    /api/v1/platform/crm/records/:entityType/:recordId/tags
PUT    /api/v1/platform/crm/records/:entityType/:recordId/tags
GET    /api/v1/platform/crm/filter-fields?entityType=DEAL
GET    /api/v1/platform/crm/saved-views?entityType=DEAL
POST   /api/v1/platform/crm/saved-views
GET    /api/v1/platform/crm/saved-views/:id
PATCH  /api/v1/platform/crm/saved-views/:id
POST   /api/v1/platform/crm/saved-views/:id/archive
GET    /api/v1/platform/crm/segments?entityType=LEAD
POST   /api/v1/platform/crm/segments
POST   /api/v1/platform/crm/segments/preview
GET    /api/v1/platform/crm/segments/:id
GET    /api/v1/platform/crm/segments/:id/preview
GET    /api/v1/platform/crm/segments/:id/records?page=1&pageSize=25
PATCH  /api/v1/platform/crm/segments/:id
POST   /api/v1/platform/crm/segments/:id/archive
~~~

Organization, Contact, Lead, and Deal list routes accept an optional `filter` query parameter containing the same JSON AST used by saved views and Segments. The AST is `{version:1,logic:"AND"|"OR",conditions:[{field,operator,value}]}`; it is flat and capped at 20 conditions. Field/operator pairs and sort keys are allowlisted per entity type. User values are parameters, never SQL fragments. List filtering stays in PostgreSQL before pagination.

`crm.read` grants field/tag/filter-field and Segment reads, record metadata reads, and views visible to the caller. `crm.manage` grants metadata/tag writes, record metadata updates, Segment writes, and saved-view writes. PRIVATE views are owner-only; SHARED views are readable by CRM readers, but only the owner may update/archive. Segments are dynamic and store definitions only.

Selecting a Saved View adds its ID as the list URL's `savedView` parameter; refreshing that URL restores the view and reruns its current query. The raw ad-hoc AST remains in list component state until saved. Segment detail is rendered at `/platform/crm/segments/:id`; its member list uses the paginated records endpoint.

## Phase 8 Lead scoring

~~~text
GET    /api/v1/platform/crm/scoring/rules
POST   /api/v1/platform/crm/scoring/rules
POST   /api/v1/platform/crm/scoring/rules/preview
PATCH  /api/v1/platform/crm/scoring/rules/:id
POST   /api/v1/platform/crm/scoring/rules/:id/archive
GET    /api/v1/platform/crm/leads/:leadId/score
POST   /api/v1/platform/crm/leads/:leadId/recalculate-score
POST   /api/v1/platform/crm/scoring/recalculate
~~~

Rule bodies contain a name, optional description, `FIT|ENGAGEMENT` category, the shared version-1 flat Lead filter AST, signed integer points (-100..100), optional enabled state, and sort order (0..10000). Only active definitions, Tag IDs, and select options are accepted at creation/update; criteria referencing inactive/archived fields are retained but do not contribute, and rule reads return a configuration warning. Rules cannot reference score-derived fields. At most 100 rules may be enabled. Rule archive is soft and triggers recalculation.

`crm.read` can list rules, preview matches, and read a Lead score plus its last 10 change snapshots. `crm.manage` is required to create/update/archive rules and request recalculation. Lead list routes accept score fields through the existing `filter` AST and score keys as server-side sort values. See [SCORING.md](SCORING.md) for formula, supported source fields, refresh policy, and conversion semantics.

## Errors and archive behavior

Use standard Nest status behavior: 400 invalid input, 401 missing/invalid authentication, 403 missing permission, 404 a missing CRM or Tenant record, and 409 a uniqueness/stale-stage conflict or update attempted on an archived record. Archive/restore are idempotent, preserve related records, and are audited with PII-free summaries. Archived rows stay readable for restore; list filters default to active rows. Archiving an Organization does not archive its Contacts, and no parent delete cascades.
