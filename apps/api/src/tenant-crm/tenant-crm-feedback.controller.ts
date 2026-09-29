import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { ClientAccessTokenGuard } from "../clients/client-access-token.guard";
import { CLIENT_PRINCIPAL, ClientAuthorizedRequest } from "../clients/client-principal";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateTenantCrmFeedbackDto, ResolveTenantCrmFeedbackDto, SubmitTenantCrmFeedbackDto, TenantCrmFeedbackListQueryDto } from "./dto/tenant-crm-feedback.dto";
import { TenantCrmService } from "./tenant-crm.service";

@Controller("tenant/crm/feedback")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.TenantCrmRead)
export class TenantCrmFeedbackController {
  constructor(private readonly crm: TenantCrmService, private readonly subscriptions: SubscriptionsService) {}

  @Get()
  async list(@Req() request: AuthorizedRequest, @Query() query: TenantCrmFeedbackListQueryDto) {
    return this.crm.listFeedback(await this.tenantId(request), query, request[TENANT_CONTEXT]!.timezone);
  }

  @Post()
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async create(@Req() request: AuthorizedRequest, @Body() input: CreateTenantCrmFeedbackDto) {
    return this.crm.createFeedback(await this.tenantId(request), request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Get(":feedbackId")
  async detail(@Req() request: AuthorizedRequest, @Param("feedbackId", ParseUUIDPipe) feedbackId: string) {
    return this.crm.feedbackDetail(await this.tenantId(request), feedbackId);
  }

  @Post(":feedbackId/needs-attention")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async needsAttention(@Req() request: AuthorizedRequest, @Param("feedbackId", ParseUUIDPipe) feedbackId: string) {
    return this.crm.markFeedbackNeedsAttention(await this.tenantId(request), feedbackId);
  }

  @Post(":feedbackId/resolve")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async resolve(@Req() request: AuthorizedRequest, @Param("feedbackId", ParseUUIDPipe) feedbackId: string, @Body() input: ResolveTenantCrmFeedbackDto) {
    return this.crm.resolveFeedback(await this.tenantId(request), request[AUTH_PRINCIPAL]!.userId, feedbackId, input);
  }

  private async tenantId(request: AuthorizedRequest) {
    const tenantId = request[TENANT_CONTEXT]!.coffeeShopId;
    await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.TenantCrm);
    return tenantId;
  }
}

@Controller("public/client-panel/feedback")
@UseGuards(TenantContextGuard, PublicTenantAvailableGuard, ClientAccessTokenGuard)
export class TenantCrmClientFeedbackController {
  constructor(private readonly crm: TenantCrmService, private readonly subscriptions: SubscriptionsService) {}

  @Get("orders/:orderId")
  async orderFeedback(@Req() request: TenantContextRequest & ClientAuthorizedRequest, @Param("orderId", ParseUUIDPipe) orderId: string) {
    const tenantId = request[TENANT_CONTEXT]!.coffeeShopId;
    await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.TenantCrm);
    return this.crm.clientFeedbackForOrder(tenantId, request[CLIENT_PRINCIPAL]!.clientId, orderId);
  }

  @Get("reservations/:reservationId")
  async reservationFeedback(@Req() request: TenantContextRequest & ClientAuthorizedRequest, @Param("reservationId", ParseUUIDPipe) reservationId: string) {
    const tenantId = request[TENANT_CONTEXT]!.coffeeShopId;
    await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.TenantCrm);
    return this.crm.clientFeedbackForReservation(tenantId, request[CLIENT_PRINCIPAL]!.clientId, reservationId);
  }

  @Post()
  async submit(@Req() request: TenantContextRequest & ClientAuthorizedRequest, @Body() input: SubmitTenantCrmFeedbackDto) {
    const tenantId = request[TENANT_CONTEXT]!.coffeeShopId;
    await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.TenantCrm);
    return this.crm.submitClientFeedback(tenantId, request[CLIENT_PRINCIPAL]!.clientId, input);
  }
}
