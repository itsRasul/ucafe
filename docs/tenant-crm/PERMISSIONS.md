# Tenant CRM permissions

## Current state

Tenant authorization is database-backed and resolved from User membership in the host-derived café. Phase 1 registers `tenant_crm.read` and the `tenant_crm` plan feature.

## Phase 1 behavior

The forward migration grants `tenant_crm.read` to the existing tenant owner role. Permission keys are globally unique in the current schema, and Platform CRM owns `crm.read` and `crm.manage` at platform scope; those keys are not reused. Custom roles follow current role-permission assignment rules; no role bypass was added.

- tenant_crm.read permits the read-only Client directory, search, and customer detail. Directory list rows mask phone; authorized detail may show the full phone for tenant operations and identity resolution.
- Phase 1 adds no CRM-managed Client mutation. Existing OTP/client self-service and staff reservation creation remain the update/create paths. Add a tenant CRM mutation permission only when a later phase introduces an actual write workflow.
- CRM APIs require tenant_crm.read and effective tenant_crm entitlement on the server.
- Promotions customer search retains its existing orders.read requirement; manual customer segment CRUD retains current menu permissions. Neither requires tenant_crm.read nor the tenant_crm feature.
- Client self-service remains on client-authenticated routes and cannot read internal CRM data.

Phase 1 list rows mask phone; a tenant_crm.read-authorized detail shows the full phone, matching the identity-resolution and operational need. Do not assume access to Orders or Reservations implies access to future CRM-only notes.

## Future capabilities

Separate permissions for notes, campaigns, loyalty, and analytics are not introduced in Phase 0. Consider them only when a feature has distinct staff duties and product packaging. Entitlement does not replace authorization, and authorization does not imply that a plan includes CRM.
