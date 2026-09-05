export const PlatformPermissions = {
  TenantsCreate: "tenants.create",
  TenantsRead: "tenants.read",
  TenantsUpdate: "tenants.update",
  TenantsLifecycleManage: "tenants.lifecycle.manage",
  SubscriptionsManage: "subscriptions.manage",
  AuditRead: "audit.read",
  UsersRead: "users.read",
  UsersManage: "users.manage",
  RolesRead: "roles.read",
  RolesManage: "roles.manage",
  PermissionsRead: "permissions.read",
} as const;

export type PlatformPermissionKey = (typeof PlatformPermissions)[keyof typeof PlatformPermissions];

export const TenantPermissions = {
  SiteManage: "site.manage",
  MenuRead: "menu.read",
  MenuManage: "menu.manage",
  ReservationsRead: "reservations.read",
  ReservationsManage: "reservations.manage",
  StaffManage: "staff.manage",
  SubscriptionRead: "subscription.read",
  SubscriptionCheckout: "subscription.checkout",
} as const;

export type TenantPermissionKey = (typeof TenantPermissions)[keyof typeof TenantPermissions];
