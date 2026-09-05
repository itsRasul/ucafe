import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { RecordSubscriptionPaymentDto } from "./dto/record-subscription-payment.dto";
import { StartTrialDto } from "./dto/start-trial.dto";
import { SubscriptionsService } from "./subscriptions.service";
import { PlatformAuditService } from "../audit/platform-audit.service";

@Controller("platform/tenants/:coffeeShopId/subscription")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
@RequirePlatformPermissions(PlatformPermissions.SubscriptionsManage)
export class PlatformSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService, private readonly audit: PlatformAuditService) {}

  @Get()
  get(@Param("coffeeShopId", new ParseUUIDPipe()) coffeeShopId: string) {
    return this.subscriptions.getPlatformSummary(coffeeShopId);
  }

  @Post("trial")
  async startTrial(@Param("coffeeShopId", new ParseUUIDPipe()) coffeeShopId: string, @Body() input: StartTrialDto, @Req() request: AuthorizedRequest) {
    const result = await this.subscriptions.startTrial(coffeeShopId, input.planKey);
    await this.audit.record({ actorUserId: request[AUTH_PRINCIPAL]!.userId, action: "subscription.trial_started", targetType: "coffee_shop", targetId: coffeeShopId, summary: { planKey: input.planKey ?? "silver" } });
    return result;
  }

  @Post("payments")
  async recordPayment(@Param("coffeeShopId", new ParseUUIDPipe()) coffeeShopId: string, @Body() input: RecordSubscriptionPaymentDto, @Req() request: AuthorizedRequest) {
    const actorUserId = request[AUTH_PRINCIPAL]!.userId;
    const result = await this.subscriptions.recordPrepaidMonth(coffeeShopId, { ...input, recordedByUserId: actorUserId });
    await this.audit.record({ actorUserId, action: "subscription.payment_recorded", targetType: "coffee_shop", targetId: coffeeShopId, summary: { paymentId: result.payment.id, amountToman: result.payment.amountToman, planKey: result.payment.planKeySnapshot } });
    return result;
  }

  @Post("reconcile")
  async reconcile(@Param("coffeeShopId", new ParseUUIDPipe()) coffeeShopId: string, @Req() request: AuthorizedRequest) {
    const result = await this.subscriptions.reconcileTenant(coffeeShopId);
    await this.audit.record({ actorUserId: request[AUTH_PRINCIPAL]!.userId, action: "subscription.reconciled", targetType: "coffee_shop", targetId: coffeeShopId, summary: { status: result.status } });
    return result;
  }
}
