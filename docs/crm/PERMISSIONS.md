# Permissions and access

## Current platform authorization

Platform operations authenticate an administrative User and use database-backed platform roles and permissions. Controllers apply AccessTokenGuard and PlatformPermissionGuard with explicit permission metadata. Tenant membership never grants platform access, and frontend navigation is not an authorization boundary.

The fixed permission catalog includes `crm.read` and `crm.manage`, initially added by migration `1790510000000-CreatePlatformCrmOrganizationsAndContacts`. Migration `1790550000000-CrmCustomerContext` adds `subscriptions.read` for the limited CRM customer-context projection. It grants that read permission to existing roles with `crm.read` or `subscriptions.manage`; later custom roles must be assigned it explicitly. Permission definitions remain code-managed; custom platform roles may be assigned only existing platform-scope permissions. See [AUTHORIZATION.md](../AUTHORIZATION.md).

## CRM permissions

Phase 1 adds the smallest fixed platform-scope permission pair:

- `crm.read` for CRM lists, detail, search, duplicate candidates, basic linked Tenant name/status, and Organization 360 overview.
- `crm.manage` for creating/editing CRM records, explicit Organization/Tenant link or unlink, assigning, qualifying, converting, archiving, restoring, and Task lifecycle actions.
- `subscriptions.read` is required with `crm.read` for the limited Tenant/Trial/Subscription context and mixed Timeline. It does not grant subscription management, invoice details, payments, Tenant members, or owner contact data.

The permission catalog can split these later into organization/contact/lead/deal permissions only when real staffing needs require different grants. Do not start with per-record sharing or an enterprise permissions matrix. Record assignment is for workload ownership, not a security filter.

Every CRM API handler declares its required permission using the existing decorator and guard. Tenant candidate reads and Tenant link/unlink require `tenants.read`; link/unlink also require `crm.manage`. Customer context and Timeline require both `crm.read` and `subscriptions.read`. Create/edit Organization DTOs cannot change `coffeeShopId`; the dedicated link operations preserve audit history. Do not trust role names, URL prefixes, hidden navigation, or possession of a UUID. A tenant-only user without a platform role cannot enter CRM.

The Organization overview requires `crm.read`. Customer context validates the Organization and reads current Tenant/Subscription projections; it requires `crm.read` plus `subscriptions.read`. Timeline also requires both because its `CUSTOMER` category includes paid Subscription operation names and entitlement-period dates. Each source is scoped to the requested Organization through its current Tenant link or that link's factual audit history. No endpoint returns gateway/provider references, payment amounts, invoice details, owner membership/contact data, or Tenant Client data.

`crm.read` grants platform operators access to Contact PII on a single-Contact detail/edit projection. Organization and Contact lists, duplicate results, and audit summaries omit full phone/email values and hashes. Add a separate PII permission only if an actual separation-of-duties need appears.

## Audit and assignment

CRM audits Organization/Contact/Lead creation and edits, explicit Tenant link/unlink, Lead qualification/unqualification/status/conversion, assignment changes, and archive/restore through `platform_audit_events` with actor, action, record type/id, and a PII-free summary. Link/unlink summaries contain only the Tenant UUID. Lead assignees are active platform Users who hold `crm.read` or `crm.manage`; assignment is workload ownership, not a record visibility boundary. Lead source-request creation uses a null actor in status history because it originates from the public form, while the operator audit table is reserved for authenticated staff actions. Audit access remains under `audit.read`, not `crm.read`.

Assignees must be active platform Users with CRM access. Do not expose CRM data to Tenant roles or Clients. Notes are plain text and use the same `crm.read`/`crm.manage` boundary; audit access remains under `audit.read`, not `crm.read`.
