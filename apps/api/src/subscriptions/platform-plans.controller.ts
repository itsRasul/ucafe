import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { UpdatePlanDto } from "./dto/update-plan.dto";
import { SubscriptionsService } from "./subscriptions.service";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { Req } from "@nestjs/common";
import { PlatformAuditService } from "../audit/platform-audit.service";

@Controller("platform/plans")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
@RequirePlatformPermissions(PlatformPermissions.SubscriptionsManage)
export class PlatformPlansController {
  constructor(private readonly subscriptions: SubscriptionsService, private readonly audit: PlatformAuditService) {}
  @Get() list() { return this.subscriptions.listPlans(); }
  @Patch(":planKey") async update(@Param("planKey") planKey: string, @Body() input: UpdatePlanDto, @Req() request: AuthorizedRequest) {
    const result = await this.subscriptions.updatePlan(planKey, input);
    await this.audit.record({ actorUserId: request[AUTH_PRINCIPAL]!.userId, action: "subscription_plan.updated", targetType: "subscription_plan", targetId: result.id, summary: { planKey, priceToman: result.priceToman, status: result.status, reservations: result.features.reservations ?? false, onlineOrdering: result.features.onlineOrdering ?? false } });
    return result;
  }
}
