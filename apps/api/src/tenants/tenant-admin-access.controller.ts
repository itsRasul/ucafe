import { Controller, ForbiddenException, Get, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { AuthorizationService } from "../authorization/authorization.service";
import { TENANT_CONTEXT } from "./tenant-context";
import { TenantContextGuard } from "./tenant-context.guard";

@Controller("tenant/admin")
@UseGuards(AccessTokenGuard, TenantContextGuard)
export class TenantAdminAccessController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Get("access")
  async access(@Req() request: AuthorizedRequest) {
    const tenant = request[TENANT_CONTEXT]!;
    const access = await this.authorization.getTenantAccess(request[AUTH_PRINCIPAL]!.userId, tenant.coffeeShopId);
    if (!access) throw new ForbiddenException("Active tenant membership is required");
    return {
      tenant: { slug: tenant.slug, status: tenant.status, locale: tenant.locale, timezone: tenant.timezone },
      permissions: access.permissions,
    };
  }
}
