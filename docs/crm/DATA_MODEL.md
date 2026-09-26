# Conceptual data model

The Lead-and-later rows below remain proposed. Phase 1 adds `crm_organizations` and `crm_contacts` to the existing PostgreSQL database through forward TypeORM migration `1790510000000-CreatePlatformCrmOrganizationsAndContacts`.

~~~mermaid
erDiagram
    CRM_ORGANIZATION ||--o{ CRM_CONTACT : owns
    CRM_ORGANIZATION ||--o{ CRM_LEAD : tracks
    CRM_CONTACT o|--o{ CRM_LEAD : primary_contact
    CRM_ORGANIZATION ||--o{ CRM_DEAL : has
    CRM_LEAD o|--o| CRM_DEAL : converts_to
    CRM_CONTACT o|--o{ CRM_DEAL : primary_contact
    CRM_ORGANIZATION ||--o{ CRM_ACTIVITY : records
    CRM_CONTACT o|--o{ CRM_ACTIVITY : relates_to
    CRM_LEAD o|--o{ CRM_ACTIVITY : relates_to
    CRM_DEAL o|--o{ CRM_ACTIVITY : relates_to
    CRM_ORGANIZATION ||--o{ CRM_TASK : schedules
    CRM_CONTACT o|--o{ CRM_TASK : relates_to
    CRM_LEAD o|--o{ CRM_TASK : relates_to
    CRM_DEAL o|--o{ CRM_TASK : relates_to
    CRM_TASK o|--o{ CRM_ACTIVITY : relates_to
    CRM_ORGANIZATION ||--o{ CRM_NOTE : documents
    CRM_LEAD o|--o{ CRM_NOTE : relates_to
    CRM_DEAL o|--o{ CRM_NOTE : relates_to
    CRM_LEAD ||--o{ CRM_LEAD_STATUS_HISTORY : changes
    CRM_DEAL ||--o{ CRM_DEAL_STAGE_HISTORY : changes
    CRM_ORGANIZATION o|--o| COFFEE_SHOP : optional_tenant_link
    CRM_LEAD o|--o| PLATFORM_ORDER_REQUEST : optional_intake_source
~~~

## Proposed record shape

All new CRM primary keys should be UUIDs. Use explicit snake_case table/column names and timestamptz audit timestamps, matching current UCafe conventions.

| Record | Initial fields to consider | Ownership / lifecycle |
|---|---|---|
| CRM Organization (`crm_organizations`) | id, name and normalized name, optional city and normalized city, optional website and host, optional canonical Instagram handle, optional unique `coffee_shop_id`, created/updated actor and timestamps, `archived_at` | CRM-owned profile. Archive it; never cascade-delete Contacts. A linked Tenant is optional and read-only. |
| CRM Contact (`crm_contacts`) | id, `organization_id`, name, optional role/title, optional AES-GCM encrypted phone/email and keyed exact-match hashes, created/updated actor and timestamps, `archived_at` | CRM-owned business contact. One Organization per Contact, with multiple Contacts per Organization. Archive while preserving the Organization. |
| CRM Lead | id, optional organization_id until intake is normalized, optional contact_id, optional unique source_request_id, source, status, assigned_to_user_id, qualification/unqualified fields, created/qualified/converted timestamps, converted_deal_id, created/updated actor and timestamps, archived_at | CRM-owned sales engagement. A linked form request remains the intake source. Status changes also write LeadStatusHistory in the same transaction. |
| CRM Deal | id, organization_id, optional primary_contact_id and originating_lead_id, name, optional estimated_amount_toman, stage, outcome, loss_reason, created/updated actor and timestamps, closed_at, won_at/lost_at, archived_at | CRM-owned opportunity estimate and explicit sales decision. Stage changes also write DealStageHistory transactionally. |
| CRM Activity | id, organization_id, optional contact/lead/deal/task ids, type, occurred_at, summary, actor_user_id, created_at | Historical interaction. Append-only except a narrowly audited correction/redaction path. |
| CRM Task | id, organization_id, optional contact/lead/deal ids, type, title, due_at, assigned_to_user_id, status, completed_at/by, canceled_at/by, created/updated actor and timestamps, archived_at | Future work and retained completion/cancellation. |
| CRM Note | id, organization_id, optional lead/deal ids, body, author_user_id, created/updated timestamps, archived_at | Internal context, access-controlled and retained; redact sensitive content deliberately instead of cascade deletion. |
| CRM LeadStatusHistory | id, lead_id, previous_status, next_status, reason, actor_user_id, created_at | Append-only transition history. |
| CRM DealStageHistory | id, deal_id, previous_stage, next_stage, reason, actor_user_id, created_at | Append-only transition history and source for time-in-stage analytics. |

Names and field details are candidates for implementation review. Do not store a second copy of Tenant status, subscription dates, plan features, invoice status, or payment state.

## Relationships and constraints

- Every Contact, Deal, Activity, Task, and Note is rooted in one Organization. A Lead may be temporarily unlinked while its intake is being normalized, but it must resolve to one Organization before qualification/conversion. A Contact belongs to one Organization in the first release; duplicate people across Organizations remain separate commercial contexts.
- CRM Organization to coffee_shop is optional one-to-one for the initial UCafe model. Use a nullable unique Tenant FK with RESTRICT semantics; do not add a reverse owner field to coffee_shops.
- CRM Lead to platform_order_request is optional one-to-one and unique on source_request_id. Do not move or duplicate the public form payload. Preserve the current table and endpoints.
- CRM Lead to its initial Deal is idempotent and traceable. One converted Lead must not create multiple initial Deals on retries. Later opportunities use new Leads/Deals.
- Use foreign keys and constraints for Organization ownership, unique tenant/source links, enum/check validity, valid amount ranges, and required terminal timestamps.
- Never hard-delete a parent whose CRM history depends on it. A Tenant soft deletion must not cascade into CRM.

## Indexing and duplicate checks

Use only indexes required by actual list and duplicate workflows:

- Organizations: active/archive state plus name, city, linked Tenant; optional normalized domain or social handle lookup.
- Contacts: organization_id plus name; organization-scoped indexes for normalized phone/email hashes.
- Leads: status/created_at, assigned_to_user_id/status/due follow-up, source, organization_id, source_request_id unique.
- Deals: organization_id/created_at, outcome/stage, assigned owner if introduced; unique initial conversion reference.
- Activities: organization_id/occurred_at and related record/time.
- Tasks: assignee/status/due_at, organization_id/status/due_at.
- Histories: parent ID plus created_at.

Exact normalized matches should show duplicate candidates. Do not make organization name+city globally unique or block shared business phone/email without evidence that UCafe has one-person-per-channel semantics. Name+city, website/domain, Instagram, and phone are signals; fuzzy matching and AI deduplication are out of scope. Never use a phone hash as public output.

### Phase 1 schema actually installed

- `crm_organizations`: nonblank `name`; `name_normalized`; optional `city`/`city_normalized`; optional normalized `website`/`website_host`; optional `instagram_handle`; optional `coffee_shop_id`; nullable creator/updater user IDs; timestamps and `archived_at`.
- `crm_contacts`: nonblank `name`; optional `role`; optional paired `phone_encrypted`/`phone_hash` and `email_encrypted`/`email_hash`; required `organization_id`; nullable creator/updater user IDs; timestamps and `archived_at`.
- `coffee_shop_id` is protected by a partial unique index and `ON DELETE RESTRICT`; Contact-to-Organization and actor references use `RESTRICT` and `SET NULL` respectively. Archiving never cascades.
- Installed indexes: Organization normalized name/city, website host, Instagram handle, active created time, and unique linked Tenant; Contact Organization/name, Organization/phone hash, Organization/email hash, and active created time. No Organization name uniqueness or Contact channel uniqueness is imposed.
- Contact phone/email ciphertext and hashes must be jointly null or jointly present. The existing `AuthCryptoService` uses AES-256-GCM for encryption and HMAC-SHA256 keyed hashes for exact duplicate lookup.

Normalization: Organization display name and city use NFC, trim, and collapsed whitespace; comparison keys are lowercase. Website input may omit a scheme (HTTPS is assumed), only HTTP/HTTPS is accepted, and query/fragment/trailing root slash are removed. Instagram is stored as a lowercase handle without `@`, including when submitted as a profile URL. Contact email is trimmed and lowercased. Contact phone uses UCafe's Iranian mobile normalizer and is stored encrypted in `+98…` form. Contact list projections omit phone/email; authorized detail/edit projections return them decrypted.

## PII, time, and money

Contact phone and email are PII. Normalize before comparison, keep plaintext out of logs and list projections, and use the existing `AuthCryptoService` AES-256-GCM encryption plus keyed HMAC-SHA256 hashes for exact lookup. Show full values only to authorized platform staff who need them.

Use UTC timestamptz values for CRM timestamps and render Persian-local dates in the web UI. Any Deal estimate is an optional integer Toman amount represented as a string at API boundaries. It is a forecast only, never recognized revenue.

## Archive and delete policy

Archive Organizations, Contacts, Leads, and Deals; reject new work on archived records unless they are explicitly restored. Keep Activities and transition history as historical evidence. Keep Tasks after completion or cancellation. Notes remain linked and are archived/redacted by an explicit authorized action. Do not cascade-delete CRM rows when a Tenant, User, or linked request is archived or soft-deleted. Hard deletion should be limited to a future documented privacy/retention policy and explicit reference checks.
