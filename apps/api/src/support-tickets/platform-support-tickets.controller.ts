import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CreateSupportTicketMessageDto, PlatformSupportTicketListQueryDto, UpdateSupportTicketDto } from "./dto/support-ticket.dto";
import { SupportTicketsService } from "./support-tickets.service";

@Controller("platform/support/tickets")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
@RequirePlatformPermissions(PlatformPermissions.SupportTicketsView)
export class PlatformSupportTicketsController {
  constructor(private readonly tickets: SupportTicketsService) {}

  @Get()
  list(@Query() query: PlatformSupportTicketListQueryDto) { return this.tickets.listPlatform(query); }

  @Get(":ticketId")
  detail(@Param("ticketId", ParseUUIDPipe) ticketId: string) { return this.tickets.detailPlatform(ticketId); }

  @Post(":ticketId/messages")
  @RequirePlatformPermissions(PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsReply)
  reply(@Req() request: AuthorizedRequest, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() input: CreateSupportTicketMessageDto) {
    return this.tickets.replyPlatform(ticketId, request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Patch(":ticketId")
  @RequirePlatformPermissions(PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsManage)
  manage(@Req() request: AuthorizedRequest, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() input: UpdateSupportTicketDto) {
    return this.tickets.manage(ticketId, request[AUTH_PRINCIPAL]!.userId, input.action);
  }
}
