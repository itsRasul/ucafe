# Tenant CRM permissions

## Current state

Tenant authorization is database-backed and resolved from User membership in the host-derived café. Phase 1 registers `tenant_crm.read` and the `tenant_crm` plan feature.

## Phase 1 behavior

The forward migration grants `tenant_crm.read` to the existing tenant owner role. Permission keys are globally unique in the current schema, and Platform CRM owns `crm.read` and `crm.manage` at platform scope; those keys are not reused. Custom roles follow current role-permission assignment rules; no role bypass was added.

- tenant_crm.read permits the read-only Client directory, search, and customer detail. Directory list rows mask phone; authorized detail may show the full phone for tenant operations and identity resolution.
- Client identity creation, editing, and authentication remain with their existing source workflows. Phase 3 adds `tenant_crm.manage` only for CRM-owned relationship data; it does not mutate Client identity.
- CRM APIs require tenant_crm.read and effective tenant_crm entitlement on the server.
- Promotions customer search retains its existing orders.read requirement; manual customer segment CRUD retains current menu permissions. Neither requires tenant_crm.read nor the tenant_crm feature.
- Client self-service remains on client-authenticated routes and cannot read internal CRM data.

## Phase 2 CRM-only source projection

`tenant_crm.read` also permits the Customer 360 summary, five-row recent Order/Reservation previews, and reconstructed Timeline. This is an intentionally limited CRM projection, not a grant of `orders.read` or `reservations.read`, and it does not permit their list/detail/mutation/settings APIs. Source-module permissions remain independently enforced on source routes. The CRM DTOs expose only CRM-relevant fields: Order ID/display number, current status, total amount, delivery method, creation/latest-status time; Reservation ID, current status, reservation date/time, party size, creation/latest-status time; and Timeline event type/time/source identity plus limited event metadata. They omit internal Order/Reservation/customer/staff notes, addresses, line items, acting staff IDs, and other source-module data. Links to source screens are shown only when the corresponding source `read` permission is present.

Directory list rows mask phone; a tenant_crm.read-authorized customer detail shows the full phone, matching the identity-resolution and operational need. Do not assume access to Orders or Reservations implies access to future CRM-only notes, or that CRM read grants source-module access.

## Future capabilities

**Phase 3 access.**

`tenant_crm.read` plus the effective `tenant_crm` feature gates all Phase 3 reads, including metadata administration and reminder views. `tenant_crm.manage` is additionally required for preference, note, tag, custom-field, assignment, and reminder mutations. The migration grants manage to the tenant owner role; other roles require explicit permission assignment. No CRM metadata is exposed to Clients.

Separate permissions for notes, campaigns, loyalty, and analytics are not introduced in Phase 0. Consider them only when a feature has distinct staff duties and product packaging. Entitlement does not replace authorization, and authorization does not imply that a plan includes CRM.

## Phase 4 access

Segment field metadata, list/detail, unsaved and saved previews, member pages, and Smart Group reads require tenant_crm.read plus the effective tenant_crm entitlement. Segment create, edit, criteria replacement, activation, and deactivation additionally require tenant_crm.manage. Controllers use the existing access-token, tenant-context, and tenant-permission guards; each route resolves and checks the feature against the trusted café context.

The builder hides mutation controls for users without manage permission, while server guards remain authoritative. Criteria, members, and Smart Groups are internal tenant CRM data and are not exposed through Client-authenticated routes. Segment APIs do not change Promotions permissions or Platform CRM permissions.

## Phase 5 Loyalty access

Program, reward, Client Loyalty summary, ledger, and redemption history reads require `tenant_crm.read` and effective `tenant_crm`. Program/reward changes, manual adjustments, and staff redemptions additionally require `tenant_crm.manage`. No loyalty-specific permission or feature flag is introduced. Management controls are hidden when the manager permission is absent; each API route independently checks trusted tenant context, permission, and entitlement.

## Phase 6 Feedback access

Feedback inbox, detail, Customer 360 summary/recent items, and Timeline projections require `tenant_crm.read` plus effective `tenant_crm`. Manual Feedback creation, marking Needs Attention, resolution, and Reminder creation additionally require `tenant_crm.manage`; no granular permission is added. Customer-panel endpoints are separate Client-authenticated routes protected by existing Tenant and Client access guards and feature entitlement. They return only the authenticated Client's own Feedback fields and never recovery status, staff identity, internal notes, or Reminders.


## Phase 7 Offer access

Offer reads, Segment previews, audience lists, and Customer 360 Offer summaries require tenant_crm.read and menu.read plus the tenant_crm feature. Draft changes, activation, and ending also require tenant_crm.manage. Existing Promotion management permissions continue to govern discount edits; no new permission is introduced.

## Phase 9 Automation access

Automation definitions, execution history, action history, and trigger metadata require `tenant_crm.read` plus effective `tenant_crm`; definition creation/edit, activation/pause/archive, builder metadata, and time-trigger preview also require `tenant_crm.manage`. Every route uses the access-token, tenant-context, and permission guards. Background workers recheck the effective CRM feature before dispatch and before action application. No Platform CRM permission or separate automation feature flag is used.
