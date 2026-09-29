import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, StreamableFile, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateSupportTicketDto, CreateSupportTicketMessageDto, TenantSupportTicketListQueryDto } from "./dto/support-ticket.dto";
import { SupportTicketsService } from "./support-tickets.service";
import { attachmentContentDisposition, MAX_SUPPORT_TICKET_ATTACHMENT_BYTES, MAX_SUPPORT_TICKET_ATTACHMENTS } from "./support-ticket-attachment.util";

@Controller("tenant/support/tickets")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.SupportTicketsUse)
export class TenantSupportTicketsController {
  constructor(private readonly tickets: SupportTicketsService) {}

  @Post()
  @UseInterceptors(FilesInterceptor("files", MAX_SUPPORT_TICKET_ATTACHMENTS, { limits: { fileSize: MAX_SUPPORT_TICKET_ATTACHMENT_BYTES, files: MAX_SUPPORT_TICKET_ATTACHMENTS, fields: 3 } }))
  create(@Req() request: AuthorizedRequest, @Body() input: CreateSupportTicketDto, @UploadedFiles() files?: Express.Multer.File[]) {
    return this.tickets.create(request[TENANT_CONTEXT]!.coffeeShopId, request[AUTH_PRINCIPAL]!.userId, input, files);
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
  @UseInterceptors(FilesInterceptor("files", MAX_SUPPORT_TICKET_ATTACHMENTS, { limits: { fileSize: MAX_SUPPORT_TICKET_ATTACHMENT_BYTES, files: MAX_SUPPORT_TICKET_ATTACHMENTS, fields: 1 } }))
  reply(@Req() request: AuthorizedRequest, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() input: CreateSupportTicketMessageDto, @UploadedFiles() files?: Express.Multer.File[]) {
    return this.tickets.replyTenant(request[TENANT_CONTEXT]!.coffeeShopId, ticketId, request[AUTH_PRINCIPAL]!.userId, input, files);
  }

  @Get(":ticketId/attachments/:attachmentId/content")
  async attachment(@Req() request: AuthorizedRequest, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.tickets.streamTenantAttachment(request[TENANT_CONTEXT]!.coffeeShopId, ticketId, attachmentId);
    response.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    return new StreamableFile(file.body, { type: file.contentType, length: file.contentLength, disposition: attachmentContentDisposition(file.originalFilename) });
  }
}
