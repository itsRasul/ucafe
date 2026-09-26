# CRM Custom Fields

Custom Fields add descriptive CRM data without replacing core properties such as Lead status, Deal stage, CRM owner, or Tenant/Subscription state. Phase 7 supports Organizations, Contacts, Leads, and Deals; Activities, Tasks, and Notes remain unchanged.

## Storage and types

Definitions live in `crm_custom_field_definitions`; select choices have stable UUIDs in `crm_custom_field_options`. Each supported CRM record has a `custom_fields` JSONB object. The API validates every key and value against active definitions before writing. It stores select option IDs rather than labels, so a label change keeps historical values readable.

Supported types are `TEXT`, `LONG_TEXT`, `NUMBER`, `BOOLEAN`, `DATE`, `SINGLE_SELECT`, `MULTI_SELECT`, and `URL`. Text lengths and numeric range are bounded. Dates must be real `YYYY-MM-DD` dates. URLs must be HTTP(S) and cannot include credentials. Select values must refer to active options owned by that field.

Keys are lowercase stable identifiers matching `[a-z][a-z0-9_]{0,63}`. They are unique within a record type and cannot be changed after creation. Labels, descriptions, required state, active state, display order, and active select options can be managed in CRM Settings. Option IDs remain stable when labels change; archived options cannot be reused for new values.

## Required and inactive fields

Required values are enforced when that field is included in a value PATCH. Existing records can remain incomplete after a required field is introduced, and a PATCH to another field does not require resubmitting every value. A required value cannot be cleared. This avoids retroactively invalidating older records while keeping changes explicit.

Inactive fields stop appearing in new filter choices and record editors. Existing values remain readable. Archiving a definition keeps its values in JSONB and shows them on records that still have a value; the key cannot be reused. No field archive removes stored data.

## API and permissions

- `GET/POST /platform/crm/custom-fields` list and create definitions (`crm.read` / `crm.manage`).
- `GET/PATCH /platform/crm/custom-fields/:id` read or update a definition and its options.
- `POST /platform/crm/custom-fields/:id/archive` archives a definition.
- `GET/PATCH /platform/crm/records/:entityType/:recordId/custom-fields` reads or partially updates typed values.

Settings and record detail views expose the same definitions. Empty values are hidden in read-only detail views. New and edited values are sent only for fields changed by the operator.

Storage alternatives and migration tradeoffs are recorded in [ADR-007](ADR-007-custom-field-storage.md) and [D-081](../DECISIONS.md#d-081--platform-crm-metadata-uses-typed-jsonb-values-and-a-bounded-query-contract).
