import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { ProvisionTenantDto } from "./dto/provision-tenant.dto";
import { TenantsService } from "./tenants.service";
import { PlatformAuditService } from "../audit/platform-audit.service";

@Controller("platform/tenants")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class PlatformTenantsController {
  constructor(private readonly tenants: TenantsService, private readonly audit: PlatformAuditService) {}

  @Get()
  @RequirePlatformPermissions(PlatformPermissions.TenantsRead)
  list() { return this.tenants.listForPlatform(); }

  @Get(":coffeeShopId")
  @RequirePlatformPermissions(PlatformPermissions.TenantsRead)
  get(@Param("coffeeShopId", new ParseUUIDPipe()) coffeeShopId: string) { return this.tenants.getForPlatform(coffeeShopId); }

  @Post()
  @RequirePlatformPermissions(PlatformPermissions.TenantsCreate)
  async provision(@Body() input: ProvisionTenantDto, @Req() request: AuthorizedRequest) {
    const actorUserId = request[AUTH_PRINCIPAL]!.userId;
    const result = await this.tenants.provision({ ...input, invitedByUserId: actorUserId });
    await this.audit.record({ actorUserId, action: "tenant.provisioned", targetType: "coffee_shop", targetId: result.coffeeShopId, summary: { hostname: result.hostname, ownerInvited: Boolean(result.ownerMembershipId) } });
    return result;
  }
}
