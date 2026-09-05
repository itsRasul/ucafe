import { TenantContextRequest } from "../tenants/tenant-context";

export const AUTH_PRINCIPAL = Symbol("AUTH_PRINCIPAL");
export const MEMBERSHIP_CONTEXT = Symbol("MEMBERSHIP_CONTEXT");

export interface AuthenticationPrincipal {
  userId: string;
  sessionId: string;
}

export interface MembershipAuthorizationContext {
  membershipId: string;
  coffeeShopId: string;
}

export interface AuthorizedRequest extends TenantContextRequest {
  [AUTH_PRINCIPAL]?: AuthenticationPrincipal;
  [MEMBERSHIP_CONTEXT]?: MembershipAuthorizationContext;
}
