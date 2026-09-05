import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { AUTH_PRINCIPAL, AuthorizedRequest, MEMBERSHIP_CONTEXT } from "./auth-principal";
import { TENANT_PERMISSIONS_METADATA } from "./authorization.decorators";
import { AuthorizationService } from "./authorization.service";
import { TenantPermissionKey } from "./permission.constants";

@Injectable()
export class TenantPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly authorization: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<TenantPermissionKey[]>(TENANT_PERMISSIONS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) throw new ForbiddenException("Tenant permission metadata is required");

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const principal = request[AUTH_PRINCIPAL];
    if (!principal) throw new UnauthorizedException();

    const tenant = request[TENANT_CONTEXT];
    if (!tenant) throw new NotFoundException("Tenant was not found for this hostname");

    const result = await this.authorization.authorizeTenant(principal.userId, tenant.coffeeShopId, required);
    if (!result.permitted || !result.membershipId) throw new ForbiddenException("Tenant permission denied");

    request[MEMBERSHIP_CONTEXT] = { membershipId: result.membershipId, coffeeShopId: tenant.coffeeShopId };
    return true;
  }
}
