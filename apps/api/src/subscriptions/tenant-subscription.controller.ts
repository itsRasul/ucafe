import { Body, Controller, Delete, Get, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissions } from "../authorization/permission.constants";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { SubscriptionsService } from "./subscriptions.service";
import { CancelScheduledPlanDto, PreviewSubscriptionDto, SchedulePlanDto } from "./dto/subscription-action.dto";

@Controller("tenant/subscription")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
export class TenantSubscriptionController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequireTenantPermissions(TenantPermissions.SubscriptionRead)
  async get(@Req() request: TenantContextRequest) {
    return this.subscriptions.getTenantSummary(request[TENANT_CONTEXT]!.coffeeShopId);
  }

  @Get("plans")
  @RequireTenantPermissions(TenantPermissions.SubscriptionRead)
  plans(@Req() request: TenantContextRequest) { return this.subscriptions.listTenantPlans(request[TENANT_CONTEXT]!.coffeeShopId); }

  @Post("preview")
  @RequireTenantPermissions(TenantPermissions.SubscriptionRead)
  preview(@Req() request: TenantContextRequest, @Body() input: PreviewSubscriptionDto) { return this.subscriptions.preview(request[TENANT_CONTEXT]!.coffeeShopId, input.planKey); }

  @Put("pending-plan")
  @RequireTenantPermissions(TenantPermissions.SubscriptionCheckout)
  schedule(@Req() request: TenantContextRequest, @Body() input: SchedulePlanDto) { return this.subscriptions.schedulePendingPlan(request[TENANT_CONTEXT]!.coffeeShopId, input.planKey, input.expectedSubscriptionVersion); }

  @Delete("pending-plan")
  @RequireTenantPermissions(TenantPermissions.SubscriptionCheckout)
  cancel(@Req() request: TenantContextRequest, @Body() input: CancelScheduledPlanDto) { return this.subscriptions.cancelPendingPlan(request[TENANT_CONTEXT]!.coffeeShopId, input.expectedSubscriptionVersion); }
}
