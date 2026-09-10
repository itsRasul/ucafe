import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ClientAccessTokenGuard } from "../clients/client-access-token.guard";
import { CLIENT_PRINCIPAL, ClientAuthorizedRequest } from "../clients/client-principal";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { AvailabilityQueryDto, CreateReservationDto } from "./dto/reservation.dto";
import { ReservationsService } from "./reservations.service";

@Controller("public/reservations")
@UseGuards(TenantContextGuard, PublicTenantAvailableGuard)
export class PublicReservationsController {
  constructor(private readonly reservations: ReservationsService) {}
  @Get("availability") availability(@Req() req: TenantContextRequest, @Query() query: AvailabilityQueryDto) { return this.reservations.availability(req[TENANT_CONTEXT]!.coffeeShopId, query); }
  @Post() @UseGuards(ClientAccessTokenGuard) create(@Req() req: TenantContextRequest & ClientAuthorizedRequest, @Body() input: CreateReservationDto) { return this.reservations.create(req[TENANT_CONTEXT]!.coffeeShopId, req[CLIENT_PRINCIPAL]!.clientId, input); }
  @Get("mine") @UseGuards(ClientAccessTokenGuard) mine(@Req() req: TenantContextRequest & ClientAuthorizedRequest) { return this.reservations.mine(req[TENANT_CONTEXT]!.coffeeShopId, req[CLIENT_PRINCIPAL]!.clientId); }
}
