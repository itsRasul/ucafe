# Conceptual data model

Phase 1 adds `crm_organizations` and `crm_contacts` through migration `1790510000000-CreatePlatformCrmOrganizationsAndContacts`. Phase 2 adds `crm_leads` and `crm_lead_status_history` through `1790520000000-CreatePlatformCrmLeads`. Phase 3 adds `crm_deals` and `crm_deal_stage_history` through `1790530000000-CreatePlatformCrmDeals`. Phase 4 adds `crm_activities`, `crm_tasks`, and `crm_notes` through `1790540000000-CreatePlatformCrmWorkRecords`.

~~~mermaid
erDiagram
    CRM_ORGANIZATION ||--o{ CRM_CONTACT : owns
    CRM_ORGANIZATION ||--o{ CRM_LEAD : tracks
    CRM_CONTACT o|--o{ CRM_LEAD : primary_contact
    CRM_ORGANIZATION ||--o{ CRM_DEAL : has
    CRM_LEAD o|--o| CRM_DEAL : may_seed_in_phase_3
    CRM_CONTACT o|--o{ CRM_DEAL : primary_contact
    CRM_ORGANIZATION o|--o{ CRM_ACTIVITY : records
    CRM_CONTACT o|--o{ CRM_ACTIVITY : relates_to
    CRM_LEAD o|--o{ CRM_ACTIVITY : relates_to
    CRM_DEAL o|--o{ CRM_ACTIVITY : relates_to
    CRM_ORGANIZATION o|--o{ CRM_TASK : schedules
    CRM_CONTACT o|--o{ CRM_TASK : relates_to
    CRM_LEAD o|--o{ CRM_TASK : relates_to
    CRM_DEAL o|--o{ CRM_TASK : relates_to
    CRM_ORGANIZATION o|--o{ CRM_NOTE : documents
    CRM_CONTACT o|--o{ CRM_NOTE : relates_to
    CRM_LEAD o|--o{ CRM_NOTE : relates_to
    CRM_DEAL o|--o{ CRM_NOTE : relates_to
    CRM_LEAD ||--o{ CRM_LEAD_STATUS_HISTORY : changes
    CRM_DEAL ||--o{ CRM_DEAL_STAGE_HISTORY : changes
    CRM_ORGANIZATION o|--o| COFFEE_SHOP : optional_tenant_link
    CRM_LEAD o|--o| PLATFORM_ORDER_REQUEST : optional_intake_source
~~~

## Record shape

All new CRM primary keys should be UUIDs. Use explicit snake_case table/column names and timestamptz audit timestamps, matching current UCafe conventions.

| Record | Initial fields to consider | Ownership / lifecycle |
|---|---|---|
| CRM Organization (`crm_organizations`) | id, name and normalized name, optional city and normalized city, optional website and host, optional canonical Instagram handle, optional unique `coffee_shop_id`, created/updated actor and timestamps, `archived_at` | CRM-owned profile. Archive it; never cascade-delete Contacts. A linked Tenant is optional and read-only. |
| CRM Contact (`crm_contacts`) | id, `organization_id`, name, optional role/title, optional AES-GCM encrypted phone/email and keyed exact-match hashes, created/updated actor and timestamps, `archived_at` | CRM-owned business contact. One Organization per Contact, with multiple Contacts per Organization. Archive while preserving the Organization. |
| CRM Lead (`crm_leads`) | id, business name and normalized name, optional contact name, encrypted phone/email with keyed hashes, optional normalized city, website/host and Instagram, optional description, code-defined source/status/priority, nullable platform owner, optional Organization and primary Contact, optional unique source request, qualification/unqualified fields, qualified/converted timestamps, creator/updater, timestamps, `archived_at` | CRM-owned prospect snapshot retained after conversion. Conversion requires an Organization and Contact; Phase 2 does not create a Deal. |
| CRM LeadStatusHistory (`crm_lead_status_history`) | id, lead_id, previous_status, next_status, optional reason, nullable actor, created_at | Append-only transition history. Initial creation records a null previous status; public intake has a null actor. |
| CRM Deal (`crm_deals`) | id, unique optional `originating_lead_id`, organization/contact/owner/expected-plan references, title, integer-Toman `estimated_amount_toman`, date `expected_close_date`, code-defined pipeline/stage/status, outcome/loss details, actor/timestamps, close timestamps, archive state | CRM opportunity in one code-defined pipeline. Lead origin is unique; stage/outcome updates and their history/audit rows are transactional. |
| CRM Activity (`crm_activities`) | id, optional organization_id/contact_id/lead_id/deal_id, activity_type, subject, optional details, occurred_at, optional outcome, actor/updater/archiver, timestamps, archived_at | Historical interaction. Editable while active; archive/restore retains content. Activity is not an event or Task. |
| CRM Task (`crm_tasks`) | id, optional organization_id/contact_id/lead_id/deal_id, title, optional description, kind, status, priority, optional due_at/assignee, completion/cancellation actors and timestamps, creator/updater/archiver, timestamps, archived_at | Future work and retained completion/cancellation. `FOLLOW_UP` is a Task kind; overdue is derived from OPEN plus due time. |
| CRM Note (`crm_notes`) | id, optional organization_id/contact_id/lead_id/deal_id, plain-text body, author/updater/archiver, timestamps, archived_at | Internal context, editable while active and archived/restored explicitly. No hard-delete/redaction operation is implemented. |
| CRM DealStageHistory (`crm_deal_stage_history`) | id, deal_id, pipeline_key, nullable from_stage, to_stage, optional reason, actor_user_id, created_at | Append-only transition history and source for time-in-stage analytics. Initial creation records a null previous stage. |

### Phase 3 schema actually installed

- `crm_deals` stores `title`, required Organization, optional same-Organization Contact, optional unique originating qualified/converted Lead already linked to that Organization, nullable platform owner, optional `subscription_plans` reference for the expected Plan, optional nonnegative `bigint` amount in Toman, optional expected close date, `ucafe-default` pipeline key, one of six stable stages, OPEN/WON/LOST outcome, loss reason/detail, actor IDs, lifecycle timestamps, and archive state.
- `crm_deal_stage_history` is append-only, references its Deal with `ON DELETE RESTRICT`, retains pipeline/from/to stage, optional reason, actor, and timestamp. Indexes cover Deal history order and active pipeline/stage/update order, owner, Organization, expected Plan, and expected close date. A unique partial index prevents two Deals from claiming one originating Lead.
- Foreign keys/checks enforce same-Organization Contact and Lead links, expected Plan reference, nonnegative estimate, stage/status/loss keys, and consistent open/closed outcome timestamps. Service validation requires a qualified/converted Lead and a matching Organization. FKs are restrictive for business history; actor references become null on user deletion. No pipeline/stage lookup tables are created.

### Phase 4 schema actually installed

- Activities record `CALL`, `MEETING`, `DEMO`, `EMAIL`, `SMS`, `WHATSAPP`, or `OTHER`; call and meeting/demo outcomes are constrained to their type-specific sets. `occurred_at` is the interaction time, not the create time. Actor and archive metadata are nullable User references with `ON DELETE SET NULL`.
- Tasks use `GENERAL|FOLLOW_UP`, `OPEN|COMPLETED|CANCELED`, and `LOW|NORMAL|HIGH|URGENT`. Database checks keep completion and cancellation timestamps mutually exclusive and aligned with status. Open Tasks cannot be archived through the service. Overdue is derived at read time and is not persisted.
- Notes contain plain text only; author, updater, and archiver references are nullable and use `ON DELETE SET NULL`.
- Each work row has explicit optional Organization, Contact, Lead, and Deal foreign keys, and at least one CRM association is required. A Lead-only work row is allowed before conversion; after conversion its Organization context is resolved through the Lead in list projections. Work can be attached to multiple records only when they share one Organization. No polymorphic entity key or Activity-to-Task foreign key exists.
- Parent links use restrictive foreign keys and same-Organization composite keys; service validation locks and checks referenced records and rejects archived records for new/changed work. Supporting partial indexes cover active records by Organization and related record, plus Task assignee/status/due time.
- Work changes and their PII-safe `platform_audit_events` rows commit together. Activity subjects/details, Task titles/descriptions, and Note bodies are excluded from audit summaries.

Do not store a second copy of Tenant status, subscription dates, plan features, invoice status, or payment state.

## Relationships and constraints

- Every Contact and Deal is rooted in one Organization. Activities, Tasks, and Notes may link to an Organization, Contact, Lead, or Deal. Contact/Deal and already-converted Lead associations must agree on Organization. Lead-only work may exist before conversion without an Organization; after conversion, reads resolve its Organization through the Lead. A Lead may start without canonical links and can optionally link an Organization and Contact. Conversion requires a matched or newly created Organization and a Contact belonging to it. A Contact belongs to one Organization; duplicate people across Organizations remain separate commercial contexts.
- CRM Organization to coffee_shop is optional one-to-one for the initial UCafe model. Use a nullable unique Tenant FK with RESTRICT semantics; do not add a reverse owner field to coffee_shops.
- CRM Lead to platform_order_request is optional one-to-one and unique on source_request_id. Public consultation acceptance creates one linked Lead in the same transaction; prior requests are not backfilled. Preserve the current table and endpoints.
- Conversion locks the Lead row. Organization, Contact, status, timestamp, history, and audit changes commit in one transaction; retry returns existing links without creating duplicates. Phase 3 can add a Deal relationship without changing Lead conversion history.
- Use foreign keys and constraints for Organization ownership, unique tenant/source links, enum/check validity, valid amount ranges, and required terminal timestamps.
- Never hard-delete a parent whose CRM history depends on it. A Tenant soft deletion must not cascade into CRM.

## Indexing and duplicate checks

Use indexes required by the active list and duplicate workflows:

- Organizations: active/archive state plus name, city, linked Tenant; optional normalized domain or social handle lookup.
- Contacts: organization_id plus name; organization-scoped indexes for normalized phone/email hashes.
- Leads: active status/created_at, owner/status, source/created_at, organization_id, primary_contact_id, normalized name/city, normalized city, phone/email hashes, source_request_id unique.
- Deals: organization_id/created_at, outcome/stage, assigned owner if introduced; unique initial conversion reference.
- Activities: partial active indexes by organization/contact/lead/deal/actor and occurred_at.
- Tasks: partial active indexes by assignee/status/due_at, organization/status/due_at, and each related record/due_at.
- Notes: partial active indexes by organization/contact/lead/deal and created_at.
- Histories: parent ID plus created_at.

Exact normalized matches should show duplicate candidates. Do not make organization name+city globally unique or block shared business phone/email without evidence that UCafe has one-person-per-channel semantics. Name+city, website/domain, Instagram, and phone are signals; fuzzy matching and AI deduplication are out of scope. Never use a phone hash as public output.

### Phase 1 schema actually installed

- `crm_organizations`: nonblank `name`; `name_normalized`; optional `city`/`city_normalized`; optional normalized `website`/`website_host`; optional `instagram_handle`; optional `coffee_shop_id`; nullable creator/updater user IDs; timestamps and `archived_at`.
- `crm_contacts`: nonblank `name`; optional `role`; optional paired `phone_encrypted`/`phone_hash` and `email_encrypted`/`email_hash`; required `organization_id`; nullable creator/updater user IDs; timestamps and `archived_at`.
- `coffee_shop_id` is protected by a partial unique index and `ON DELETE RESTRICT`; Contact-to-Organization and actor references use `RESTRICT` and `SET NULL` respectively. Archiving never cascades.
- Installed indexes: Organization normalized name/city, website host, Instagram handle, active created time, and unique linked Tenant; Contact Organization/name, Organization/phone hash, Organization/email hash, and active created time. No Organization name uniqueness or Contact channel uniqueness is imposed.
- Contact phone/email ciphertext and hashes must be jointly null or jointly present. The existing `AuthCryptoService` uses AES-256-GCM for encryption and HMAC-SHA256 keyed hashes for exact duplicate lookup.

### Phase 2 schema actually installed

- `crm_leads` stores the prospect snapshot, code-defined `source`, `status`, and `priority`, nullable owner and canonical links, optional unique `source_request_id`, qualification and unqualification context, lifecycle timestamps, actor references, and archive state.
- Sources: `OUTBOUND_CALL`, `LANDING_FORM`, `SEO`, `INSTAGRAM`, `REFERRAL`, `SMS`, `PARTNER`, `MANUAL`, `OTHER`. Priorities: `LOW`, `NORMAL`, `HIGH`. Statuses: `NEW`, `ATTEMPTING_CONTACT`, `CONTACTED`, `QUALIFIED`, `NURTURING`, `UNQUALIFIED`, `CONVERTED`.
- `crm_lead_status_history` retains each transition's previous/next status, reason, actor, and timestamp. Indexes cover active status/creation time, active owner/status, active source/creation time, Organization, Contact, normalized business name/city, normalized city, phone/email hashes, and unique source request. Lead phone/email use the existing AES-256-GCM encryption and keyed HMAC helpers.
- Converted Leads require an Organization, Contact, and `converted_at`; nonconverted Leads cannot have a conversion timestamp. Qualified/converted states retain `qualified_at`, and a Contact link requires an Organization.
- `source_request_id` points to one `platform_order_requests` row with `ON DELETE RESTRICT`; only `LANDING_FORM` Leads may carry this source reference. Historical requests are not backfilled.

Normalization: Organization display name and city use NFC, trim, and collapsed whitespace; comparison keys are lowercase. Website input may omit a scheme (HTTPS is assumed), only HTTP/HTTPS is accepted, and query/fragment/trailing root slash are removed. Instagram is stored as a lowercase handle without `@`, including when submitted as a profile URL. Contact email is trimmed and lowercased. Contact phone uses UCafe's Iranian mobile normalizer and is stored encrypted in `+98…` form. Contact list projections omit phone/email; authorized detail/edit projections return them decrypted.

## PII, time, and money

Contact and Lead phone/email are PII. Normalize before comparison, keep plaintext out of logs and list/duplicate projections, and use the existing `AuthCryptoService` AES-256-GCM encryption plus keyed HMAC-SHA256 hashes for exact lookup. Authorized CRM detail/edit projections may reveal values.

Use UTC timestamptz values for CRM timestamps and render Persian-local dates in the web UI. Any Deal estimate is an optional integer Toman amount represented as a string at API boundaries. It is a forecast only, never recognized revenue.

## Archive and delete policy

Archive Organizations, Contacts, Leads, and Deals; reject new or changed work on archived records unless they are explicitly restored. Activities and Notes may be edited while active, then archived/restored while retaining content. Tasks remain after completion or cancellation; an OPEN Task must first be completed or canceled before archive. Work and transition history are retained and have no hard-delete route. Do not cascade-delete CRM rows when a Tenant, User, or linked request is archived or soft-deleted. A future privacy/retention operation requires an explicit policy and reference checks.
