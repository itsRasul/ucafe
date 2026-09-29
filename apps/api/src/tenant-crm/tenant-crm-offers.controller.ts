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
import { CreateTenantCrmOfferDto, PreviewTenantCrmOfferDto, TenantCrmOfferClientsQueryDto, TenantCrmOfferListQueryDto, UpdateTenantCrmOfferDto } from "./dto/tenant-crm-offers.dto";
import { TenantCrmOffersService } from "./tenant-crm-offers.service";

@Controller("tenant/crm")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.MenuRead)
export class TenantCrmOffersController {
  constructor(private readonly offers: TenantCrmOffersService, private readonly subscriptions: SubscriptionsService) {}

  @Get("offers")
  async list(@Req() request: AuthorizedRequest, @Query() query: TenantCrmOfferListQueryDto) {
    return this.offers.list((await this.tenant(request)).coffeeShopId, query);
  }

  @Get("offers/:offerId/clients")
  async audience(@Req() request: AuthorizedRequest, @Param("offerId", ParseUUIDPipe) offerId: string, @Query() query: TenantCrmOfferClientsQueryDto) {
    return this.offers.audienceMembers((await this.tenant(request)).coffeeShopId, offerId, query);
  }

  @Get("offers/:offerId")
  async detail(@Req() request: AuthorizedRequest, @Param("offerId", ParseUUIDPipe) offerId: string) {
    return this.offers.detail((await this.tenant(request)).coffeeShopId, offerId);
  }

  @Post("offers/preview")
  async preview(@Req() request: AuthorizedRequest, @Body() input: PreviewTenantCrmOfferDto) {
    const tenant = await this.tenant(request);
    return this.offers.preview(tenant.coffeeShopId, tenant.timezone, input.segmentId);
  }

  @Post("offers")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage, TenantPermissions.MenuRead)
  async create(@Req() request: AuthorizedRequest, @Body() input: CreateTenantCrmOfferDto) {
    const tenant = await this.tenant(request);
    return this.offers.createDraft(tenant.coffeeShopId, request[AUTH_PRINCIPAL]!.userId, tenant.timezone, input);
  }

  @Patch("offers/:offerId")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage, TenantPermissions.MenuRead)
  async update(@Req() request: AuthorizedRequest, @Param("offerId", ParseUUIDPipe) offerId: string, @Body() input: UpdateTenantCrmOfferDto) {
    const tenant = await this.tenant(request);
    return this.offers.updateDraft(tenant.coffeeShopId, tenant.timezone, offerId, input);
  }

  @Post("offers/:offerId/activate")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage, TenantPermissions.MenuRead)
  async activate(@Req() request: AuthorizedRequest, @Param("offerId", ParseUUIDPipe) offerId: string) {
    const tenant = await this.tenant(request);
    return this.offers.activate(tenant.coffeeShopId, tenant.timezone, offerId);
  }

  @Post("offers/:offerId/end")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage, TenantPermissions.MenuRead)
  async end(@Req() request: AuthorizedRequest, @Param("offerId", ParseUUIDPipe) offerId: string) {
    return this.offers.end((await this.tenant(request)).coffeeShopId, offerId);
  }

  @Get("clients/:clientId/offers")
  async clientOffers(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Query() query: TenantCrmOfferClientsQueryDto) {
    return this.offers.clientOffers((await this.tenant(request)).coffeeShopId, clientId, query);
  }

  private async tenant(request: AuthorizedRequest) {
    const tenant = request[TENANT_CONTEXT]!;
    await this.subscriptions.requireFeature(tenant.coffeeShopId, SubscriptionFeatures.TenantCrm);
    return tenant;
  }
}
