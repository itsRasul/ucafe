import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
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
  @Post() @UseGuards(AccessTokenGuard) create(@Req() req: TenantContextRequest & AuthorizedRequest, @Body() input: CreateReservationDto) { return this.reservations.create(req[TENANT_CONTEXT]!.coffeeShopId, req[AUTH_PRINCIPAL]!.userId, input); }
  @Get("mine") @UseGuards(AccessTokenGuard) mine(@Req() req: TenantContextRequest & AuthorizedRequest) { return this.reservations.mine(req[TENANT_CONTEXT]!.coffeeShopId, req[AUTH_PRINCIPAL]!.userId); }
}
