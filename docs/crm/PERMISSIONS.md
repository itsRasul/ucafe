# Permissions and access

## Current platform authorization

Platform operations authenticate an administrative User and use database-backed platform roles and permissions. Controllers apply AccessTokenGuard and PlatformPermissionGuard with explicit permission metadata. Tenant membership never grants platform access, and frontend navigation is not an authorization boundary.

The fixed permission catalog includes `crm.read` and `crm.manage`, initially added by migration `1790510000000-CreatePlatformCrmOrganizationsAndContacts`. Existing and new `platform_owner` assignments receive both keys. Phase 2 updates their descriptions and Phase 4 aligns them with the added work records; no additional permission key is introduced. Permission definitions remain code-managed; custom platform roles may be assigned only existing platform-scope permissions. See [AUTHORIZATION.md](../AUTHORIZATION.md).

## CRM permissions

Phase 1 adds the smallest fixed platform-scope permission pair:

- `crm.read` for CRM lists, detail, search, duplicate candidates, and read-only linked context.
- `crm.manage` for creating, editing, assigning, qualifying, unqualifying, converting, archiving, and restoring Organizations, Contacts, Leads, Deals, Activities, Tasks, and Notes, and for Task lifecycle actions.

The permission catalog can split these later into organization/contact/lead/deal permissions only when real staffing needs require different grants. Do not start with per-record sharing or an enterprise permissions matrix. Record assignment is for workload ownership, not a security filter.

Every CRM API handler declares its required permission using the existing decorator and guard. The Tenant-link candidate endpoint additionally requires `tenants.read`. Do not trust role names, URL prefixes, hidden navigation, or possession of a UUID. A tenant-only user without a platform role cannot enter CRM.

`crm.read` grants platform operators access to Contact PII on a single-Contact detail/edit projection. Organization and Contact lists, duplicate results, and audit summaries omit full phone/email values and hashes. Add a separate PII permission only if an actual separation-of-duties need appears.

## Audit and assignment

CRM audits Organization/Contact/Lead creation and edits, Lead qualification/unqualification/status/conversion, assignment changes, and archive/restore through `platform_audit_events` with actor, action, record type/id, and a PII-free summary. Lead assignees are active platform Users who hold `crm.read` or `crm.manage`; assignment is workload ownership, not a record visibility boundary. Lead source-request creation uses a null actor in status history because it originates from the public form, while the operator audit table is reserved for authenticated staff actions. Audit access remains under `audit.read`, not `crm.read`.

Assignees must be active platform Users with CRM access. Do not expose CRM data to Tenant roles or Clients. Notes are plain text and use the same `crm.read`/`crm.manage` boundary; audit access remains under `audit.read`, not `crm.read`.
