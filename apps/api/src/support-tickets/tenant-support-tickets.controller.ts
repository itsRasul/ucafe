import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateSupportTicketDto, CreateSupportTicketMessageDto, TenantSupportTicketListQueryDto } from "./dto/support-ticket.dto";
import { SupportTicketsService } from "./support-tickets.service";

@Controller("tenant/support/tickets")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.SupportTicketsUse)
export class TenantSupportTicketsController {
  constructor(private readonly tickets: SupportTicketsService) {}

  @Post()
  create(@Req() request: AuthorizedRequest, @Body() input: CreateSupportTicketDto) {
    return this.tickets.create(request[TENANT_CONTEXT]!.coffeeShopId, request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Get()
  list(@Req() request: AuthorizedRequest, @Query() query: TenantSupportTicketListQueryDto) {
    return this.tickets.listTenant(request[TENANT_CONTEXT]!.coffeeShopId, query);
  }

  @Get(":ticketId")
  detail(@Req() request: AuthorizedRequest, @Param("ticketId", ParseUUIDPipe) ticketId: string) {
    return this.tickets.detailTenant(request[TENANT_CONTEXT]!.coffeeShopId, ticketId);
  }

  @Post(":ticketId/messages")
  reply(@Req() request: AuthorizedRequest, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() input: CreateSupportTicketMessageDto) {
    return this.tickets.replyTenant(request[TENANT_CONTEXT]!.coffeeShopId, ticketId, request[AUTH_PRINCIPAL]!.userId, input);
  }
}
