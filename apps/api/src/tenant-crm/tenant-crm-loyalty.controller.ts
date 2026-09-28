import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { AdjustTenantCrmLoyaltyDto, CreateTenantCrmRewardDto, RedeemTenantCrmRewardDto, TenantCrmLoyaltyListQueryDto,
  UpdateTenantCrmLoyaltyProgramDto, UpdateTenantCrmRewardDto } from "./dto/tenant-crm-loyalty.dto";
import { TenantCrmLoyaltyService } from "./tenant-crm-loyalty.service";

@Controller("tenant/crm")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.TenantCrmRead)
export class TenantCrmLoyaltyController {
  constructor(private readonly loyalty: TenantCrmLoyaltyService, private readonly subscriptions: SubscriptionsService) {}

  @Get("loyalty/program")
  async program(@Req() request: AuthorizedRequest) { return this.loyalty.program(await this.tenantId(request)); }

  @Patch("loyalty/program")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async updateProgram(@Req() request: AuthorizedRequest, @Body() input: UpdateTenantCrmLoyaltyProgramDto) {
    return this.loyalty.updateProgram(await this.tenantId(request), request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Get("loyalty/rewards")
  async rewards(@Req() request: AuthorizedRequest, @Query() query: TenantCrmLoyaltyListQueryDto) {
    return this.loyalty.rewards(await this.tenantId(request), query);
  }

  @Post("loyalty/rewards")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async createReward(@Req() request: AuthorizedRequest, @Body() input: CreateTenantCrmRewardDto) {
    return this.loyalty.createReward(await this.tenantId(request), request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Patch("loyalty/rewards/:rewardId")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async updateReward(@Req() request: AuthorizedRequest, @Param("rewardId", ParseUUIDPipe) rewardId: string, @Body() input: UpdateTenantCrmRewardDto) {
    return this.loyalty.updateReward(await this.tenantId(request), request[AUTH_PRINCIPAL]!.userId, rewardId, input);
  }

  @Get("clients/:clientId/loyalty")
  async clientLoyalty(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string) {
    return this.loyalty.clientLoyalty(await this.tenantId(request), clientId);
  }

  @Get("clients/:clientId/loyalty/ledger")
  async ledger(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Query() query: TenantCrmLoyaltyListQueryDto) {
    return this.loyalty.ledger(await this.tenantId(request), clientId, query);
  }

  @Post("clients/:clientId/loyalty/adjust")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async adjust(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Body() input: AdjustTenantCrmLoyaltyDto) {
    return this.loyalty.adjust(await this.tenantId(request), clientId, request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Post("clients/:clientId/loyalty/redeem")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async redeem(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Body() input: RedeemTenantCrmRewardDto) {
    return this.loyalty.redeem(await this.tenantId(request), clientId, request[AUTH_PRINCIPAL]!.userId, input);
  }

  private async tenantId(request: AuthorizedRequest) {
    const tenantId = request[TENANT_CONTEXT]!.coffeeShopId;
    await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.TenantCrm);
    return tenantId;
  }
}
