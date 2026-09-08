import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissions } from "../authorization/permission.constants";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { renewalWindow } from "./subscription-summary.util";
import { SubscriptionsService } from "./subscriptions.service";

@Controller("tenant/subscription")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.SubscriptionRead)
export class TenantSubscriptionController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  async get(@Req() request: TenantContextRequest) {
    const subscription = await this.subscriptions.getForTenant(request[TENANT_CONTEXT]!.coffeeShopId);
    const periodEnd = subscription.currentPeriodEndsAt ?? subscription.trialEndsAt;
    const renewal = renewalWindow(periodEnd);
    return {
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
      graceEndsAt: subscription.graceEndsAt,
      ...renewal,
      plan: { key: subscription.plan.key, name: subscription.plan.name, priceToman: subscription.plan.priceToman, billingMonths: subscription.plan.billingMonths, graceDays: subscription.plan.graceDays, features: subscription.plan.features },
    };
  }
}
