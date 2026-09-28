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
