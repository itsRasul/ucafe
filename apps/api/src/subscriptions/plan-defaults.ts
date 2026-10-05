export const defaultPlanFeatures = {
  bronze: { menu: true, reservations: true, onlineOrdering: false, analytics: false, tenant_crm: false, inventory: false },
  silver: { menu: true, reservations: true, onlineOrdering: true, analytics: true, tenant_crm: false, inventory: false },
  golden: { menu: true, reservations: true, onlineOrdering: true, analytics: true, tenant_crm: true, inventory: true },
} as const;
