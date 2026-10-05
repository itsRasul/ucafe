import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { UpdatePlanDto } from "./dto/update-plan.dto";
import { SubscriptionsService } from "./subscriptions.service";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { Req } from "@nestjs/common";
import { PlatformAuditService } from "../audit/platform-audit.service";
import { CreatePlanDisplayFeatureDto, SetPlanDisplayFeatureValueDto, UpdatePlanDisplayFeatureDefinitionDto } from "./dto/plan-display-feature.dto";

@Controller("platform/plans")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
@RequirePlatformPermissions(PlatformPermissions.SubscriptionsManage)
export class PlatformPlansController {
  constructor(private readonly subscriptions: SubscriptionsService, private readonly audit: PlatformAuditService) {}
  @Get() list() { return this.subscriptions.listPlans(); }
  @Get("display-features") displayFeatures() { return this.subscriptions.listPlanDisplayFeatureManagement(); }
  @Post("display-features") async createDisplayFeature(@Body() input: CreatePlanDisplayFeatureDto, @Req() request: AuthorizedRequest) {
    const result = await this.subscriptions.createPlanDisplayFeature(input);
    await this.audit.record({ actorUserId: request[AUTH_PRINCIPAL]!.userId, action: "subscription_plan_display_feature.created", targetType: "plan_display_feature", targetId: result.id, summary: { key: result.key, label: result.label, sortOrder: result.sortOrder } });
    return result;
  }
  @Patch("display-features/:featureId") async updateDisplayFeature(@Param("featureId", ParseUUIDPipe) featureId: string, @Body() input: UpdatePlanDisplayFeatureDefinitionDto, @Req() request: AuthorizedRequest) {
    const result = await this.subscriptions.updatePlanDisplayFeatureDefinition(featureId, input);
    await this.audit.record({ actorUserId: request[AUTH_PRINCIPAL]!.userId, action: "subscription_plan_display_feature.updated", targetType: "plan_display_feature", targetId: result.id, summary: { key: result.key, label: result.label, sortOrder: result.sortOrder } });
    return result;
  }
  @Delete("display-features/:featureId") async deleteDisplayFeature(@Param("featureId", ParseUUIDPipe) featureId: string, @Req() request: AuthorizedRequest) {
    const result = await this.subscriptions.deletePlanDisplayFeatureDefinition(featureId);
    await this.audit.record({ actorUserId: request[AUTH_PRINCIPAL]!.userId, action: "subscription_plan_display_feature.deleted", targetType: "plan_display_feature", targetId: featureId, summary: {} });
    return result;
  }
  @Put(":planKey/display-features/:featureId") async setPlanDisplayFeature(@Param("planKey") planKey: string, @Param("featureId", ParseUUIDPipe) featureId: string, @Body() input: SetPlanDisplayFeatureValueDto, @Req() request: AuthorizedRequest) {
    const result = await this.subscriptions.setPlanDisplayFeatureValue(planKey, featureId, input);
    await this.audit.record({ actorUserId: request[AUTH_PRINCIPAL]!.userId, action: "subscription_plan_display_feature.value_updated", targetType: "subscription_plan", targetId: planKey, summary: { featureKey: result.key, value: result.value } });
    return result;
  }
  @Delete(":planKey/display-features/:featureId") async deletePlanDisplayFeature(@Param("planKey") planKey: string, @Param("featureId", ParseUUIDPipe) featureId: string, @Req() request: AuthorizedRequest) {
    const result = await this.subscriptions.deletePlanDisplayFeatureValue(planKey, featureId);
    await this.audit.record({ actorUserId: request[AUTH_PRINCIPAL]!.userId, action: "subscription_plan_display_feature.value_deleted", targetType: "subscription_plan", targetId: planKey, summary: { featureId } });
    return result;
  }
  @Patch(":planKey") async update(@Param("planKey") planKey: string, @Body() input: UpdatePlanDto, @Req() request: AuthorizedRequest) {
    const result = await this.subscriptions.updatePlan(planKey, input);
    await this.audit.record({ actorUserId: request[AUTH_PRINCIPAL]!.userId, action: "subscription_plan.updated", targetType: "subscription_plan", targetId: result.id, summary: { planKey, priceToman: result.priceToman, status: result.status, sortOrder: result.sortOrder, highlightedFeatureKeys: result.highlightedFeatureKeys.join(",") } });
    return result;
  }
}
