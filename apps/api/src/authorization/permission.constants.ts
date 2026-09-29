export const PlatformPermissions = {
  TenantsCreate: "tenants.create",
  TenantsRead: "tenants.read",
  TenantsUpdate: "tenants.update",
  TenantsLifecycleManage: "tenants.lifecycle.manage",
  SubscriptionsRead: "subscriptions.read",
  SubscriptionsManage: "subscriptions.manage",
  AuditRead: "audit.read",
  UsersRead: "users.read",
  UsersManage: "users.manage",
  RolesRead: "roles.read",
  RolesManage: "roles.manage",
  PermissionsRead: "permissions.read",
  ConsultationRequestsRead: "consultation_requests.read",
  CrmRead: "crm.read",
  CrmManage: "crm.manage",
  SupportTicketsView: "support.tickets.view",
  SupportTicketsReply: "support.tickets.reply",
  SupportTicketsManage: "support.tickets.manage",
} as const;

export type PlatformPermissionKey = (typeof PlatformPermissions)[keyof typeof PlatformPermissions];

export const TenantPermissions = {
  SiteManage: "site.manage",
  MenuRead: "menu.read",
  MenuManage: "menu.manage",
  ReservationsRead: "reservations.read",
  ReservationsManage: "reservations.manage",
  OrdersRead: "orders.read",
  OrdersManage: "orders.manage",
  AnalyticsRead: "analytics.read",
  InventoryRead: "inventory.read",
  InventoryManage: "inventory.manage",
  TenantCrmRead: "tenant_crm.read",
  TenantCrmManage: "tenant_crm.manage",
  SupportTicketsUse: "support.tickets.use",
  StaffManage: "staff.manage",
  SubscriptionRead: "subscription.read",
  SubscriptionCheckout: "subscription.checkout",
} as const;

export type TenantPermissionKey = (typeof TenantPermissions)[keyof typeof TenantPermissions];
