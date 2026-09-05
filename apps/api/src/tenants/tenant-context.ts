import { CoffeeShopStatus, DomainType } from "../database/entities";

export const TENANT_CONTEXT = Symbol("TENANT_CONTEXT");

export interface TenantContext {
  coffeeShopId: string;
  slug: string;
  status: CoffeeShopStatus;
  locale: string;
  timezone: string;
  hostname: string;
  domainType: DomainType;
}

export interface TenantContextRequest {
  headers: { host?: string; "x-cafexa-tenant-host"?: string | string[]; "x-cafexa-proxy-secret"?: string | string[] };
  [TENANT_CONTEXT]?: TenantContext;
}
