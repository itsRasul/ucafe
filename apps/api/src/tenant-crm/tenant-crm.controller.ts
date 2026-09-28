import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { ClientDirectoryQueryDto } from "./dto/client-directory-query.dto";
import { TenantCrmService } from "./tenant-crm.service";

@Controller("tenant/crm/clients")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.TenantCrmRead)
export class TenantCrmController {
  constructor(private readonly crm: TenantCrmService, private readonly subscriptions: SubscriptionsService) {}

  @Get()
  async list(@Req() request: AuthorizedRequest, @Query() query: ClientDirectoryQueryDto) {
    const tenantId = request[TENANT_CONTEXT]!.coffeeShopId;
    await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.TenantCrm);
    return this.crm.list(tenantId, query);
  }

  @Get(":clientId")
  async detail(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string) {
    const tenantId = request[TENANT_CONTEXT]!.coffeeShopId;
    await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.TenantCrm);
    return this.crm.detail(tenantId, clientId);
  }
}
