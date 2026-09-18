# Authorization

Authentication proves an identity. Authorization is resolved from current database state and is never delegated to frontend route hiding.

## Administrative RBAC

`roles` and `permissions` have `PLATFORM` or `TENANT` scope. `role_permissions` connects compatible scopes. A user receives:

- platform roles through `user_platform_roles`
- tenant roles through an active `coffee_shop_membership` and `membership_roles`

Tenant roles may be global system roles (`coffee_shop_id` null) or cafe-specific custom roles. Database triggers reject incompatible scope/tenant assignments.

## Guards

- `AccessTokenGuard` validates an active administrative user session.
- `PlatformPermissionGuard` requires explicit decorator metadata and all requested platform permission keys. It never considers memberships.
- `TenantPermissionGuard` requires access token, resolved tenant context, active user, active membership for that cafe, compatible role scope, and all requested tenant permission keys.
- Client routes use `ClientAccessTokenGuard` plus resource ownership checks rather than administrative RBAC.

## Permission catalog

Platform permissions:

`tenants.create`, `tenants.read`, `tenants.update`, `tenants.lifecycle.manage`, `subscriptions.manage`, `audit.read`, `users.read`, `users.manage`, `roles.read`, `roles.manage`, `permissions.read`, `consultation_requests.read`.

Tenant permissions:

`site.manage`, `menu.read`, `menu.manage`, `reservations.read`, `reservations.manage`, `orders.read`, `orders.manage`, `staff.manage`, `subscription.read`, `subscription.checkout`.

Controllers may require more than one permission; platform invoice detail/list requires both subscription management and user-read authority because the detail includes full admin contact data.

## Role management

Platform operators can create scoped custom roles and change permission assignments through protected endpoints. System/protected roles cannot be renamed or deleted. Safeguards prevent removing the last active path capable of role management. Permission definitions themselves are a fixed catalog; there is no permission-definition CRUD or direct per-user permission override.

Platform user creation assigns one selected platform or tenant role transactionally. Tenant role creation requires a matching cafe membership. User blocking revokes active sessions and is audited.

## Client authorization and features

Clients have no platform/tenant roles. The API scopes their addresses, orders, reservations, and profile operations by both resolved cafe and authenticated client ID.

Subscription feature checks are a second authorization layer. An authenticated client or tenant manager still cannot use reservations/ordering unless the effective subscription status is entitled and the plan feature flag is enabled.

## Rules for changes

- Put permission metadata on every controller operation using a platform/tenant permission guard.
- Do not infer authority from a route prefix, role name, UI navigation item, or possession of a resource UUID.
- Require all sensitive permissions explicitly; avoid broad “admin” bypasses.
- Keep platform and tenant queries separate and audit consequential platform mutations.
- Return 401 for missing/invalid authentication, 403 for authenticated but unauthorized access, and tenant-neutral 404 behavior where cross-tenant existence must not leak.

