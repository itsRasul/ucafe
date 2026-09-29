import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateTenantCrmAutomationDto, PreviewTenantCrmAutomationDto, TenantCrmAutomationExecutionListQueryDto,
  TenantCrmAutomationListQueryDto, UpdateTenantCrmAutomationDto } from "./dto/tenant-crm-automations.dto";
import { TenantCrmAutomationService } from "./tenant-crm-automation.service";
import { tenantCrmAutomationTriggers } from "./tenant-crm-automation.util";

@Controller("tenant/crm/automations")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.TenantCrmRead)
export class TenantCrmAutomationController {
  constructor(private readonly automations: TenantCrmAutomationService, private readonly subscriptions: SubscriptionsService) {}

  @Get("metadata")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async metadata(@Req() request: AuthorizedRequest, @Query("triggerType") triggerType: string) {
    const tenant = await this.tenant(request);
    if (!tenantCrmAutomationTriggers.includes(triggerType as any)) throw new BadRequestException("Unsupported automation trigger");
    return this.automations.metadata(tenant.coffeeShopId, triggerType as any);
  }

  @Get()
  async list(@Req() request: AuthorizedRequest, @Query() query: TenantCrmAutomationListQueryDto) {
    return this.automations.list((await this.tenant(request)).coffeeShopId, query);
  }

  @Post("preview")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async preview(@Req() request: AuthorizedRequest, @Body() input: PreviewTenantCrmAutomationDto) {
    const tenant = await this.tenant(request);
    return this.automations.preview(tenant.coffeeShopId, tenant.timezone, input);
  }

  @Get("executions/:executionId")
  async execution(@Req() request: AuthorizedRequest, @Param("executionId", ParseUUIDPipe) executionId: string) {
    return this.automations.executionDetail((await this.tenant(request)).coffeeShopId, executionId);
  }

  @Get(":automationId/executions")
  async executions(@Req() request: AuthorizedRequest, @Param("automationId", ParseUUIDPipe) automationId: string,
    @Query() query: TenantCrmAutomationExecutionListQueryDto) {
    return this.automations.executions((await this.tenant(request)).coffeeShopId, automationId, query);
  }

  @Post()
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async create(@Req() request: AuthorizedRequest, @Body() input: CreateTenantCrmAutomationDto) {
    const tenant = await this.tenant(request);
    return this.automations.createDraft(tenant.coffeeShopId, request[AUTH_PRINCIPAL]!.userId, input, tenant.timezone);
  }

  @Get(":automationId")
  async detail(@Req() request: AuthorizedRequest, @Param("automationId", ParseUUIDPipe) automationId: string) {
    return this.automations.detail((await this.tenant(request)).coffeeShopId, automationId);
  }

  @Patch(":automationId")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async update(@Req() request: AuthorizedRequest, @Param("automationId", ParseUUIDPipe) automationId: string,
    @Body() input: UpdateTenantCrmAutomationDto) {
    const tenant = await this.tenant(request);
    return this.automations.update(tenant.coffeeShopId, tenant.timezone, automationId, input);
  }

  @Post(":automationId/activate")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async activate(@Req() request: AuthorizedRequest, @Param("automationId", ParseUUIDPipe) automationId: string) {
    const tenant = await this.tenant(request);
    return this.automations.activate(tenant.coffeeShopId, tenant.timezone, automationId);
  }

  @Post(":automationId/pause")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async pause(@Req() request: AuthorizedRequest, @Param("automationId", ParseUUIDPipe) automationId: string) {
    return this.automations.pause((await this.tenant(request)).coffeeShopId, automationId);
  }

  @Post(":automationId/archive")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async archive(@Req() request: AuthorizedRequest, @Param("automationId", ParseUUIDPipe) automationId: string) {
    return this.automations.archive((await this.tenant(request)).coffeeShopId, automationId);
  }

  private async tenant(request: AuthorizedRequest) {
    const tenant = request[TENANT_CONTEXT]!;
    await this.subscriptions.requireFeature(tenant.coffeeShopId, SubscriptionFeatures.TenantCrm);
    return tenant;
  }
}
