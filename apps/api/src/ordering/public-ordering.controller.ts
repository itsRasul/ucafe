import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ClientAccessTokenGuard } from "../clients/client-access-token.guard";
import { CLIENT_PRINCIPAL, ClientAuthorizedRequest } from "../clients/client-principal";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateOrderDto } from "./dto/ordering.dto";
import { OrderingService } from "./ordering.service";

@Controller()
@UseGuards(TenantContextGuard, PublicTenantAvailableGuard)
export class PublicOrderingController {
  constructor(private readonly ordering: OrderingService) {}

  @Get("public/ordering/settings")
  state(@Req() request: TenantContextRequest) {
    return this.ordering.publicState(request[TENANT_CONTEXT]!.coffeeShopId);
  }

  @Post("public/orders")
  @UseGuards(ClientAccessTokenGuard)
  create(@Req() request: TenantContextRequest & ClientAuthorizedRequest, @Body() input: CreateOrderDto) {
    return this.ordering.createOrder(request[TENANT_CONTEXT]!.coffeeShopId, request[CLIENT_PRINCIPAL]!.clientId, input);
  }

  @Get("public/orders/:id")
  @UseGuards(ClientAccessTokenGuard)
  detail(@Req() request: TenantContextRequest & ClientAuthorizedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.ordering.clientDetail(request[TENANT_CONTEXT]!.coffeeShopId, request[CLIENT_PRINCIPAL]!.clientId, id);
  }
}
