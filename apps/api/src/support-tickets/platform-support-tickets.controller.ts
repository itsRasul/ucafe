import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, StreamableFile, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CreateSupportTicketMessageDto, PlatformSupportTicketListQueryDto, UpdateSupportTicketDto } from "./dto/support-ticket.dto";
import { SupportTicketsService } from "./support-tickets.service";
import { attachmentContentDisposition, MAX_SUPPORT_TICKET_ATTACHMENT_BYTES, MAX_SUPPORT_TICKET_ATTACHMENTS } from "./support-ticket-attachment.util";

@Controller("platform/support/tickets")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
@RequirePlatformPermissions(PlatformPermissions.SupportTicketsView)
export class PlatformSupportTicketsController {
  constructor(private readonly tickets: SupportTicketsService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@Query() query: PlatformSupportTicketListQueryDto) { return this.tickets.listPlatform(query); }

  @Get(":ticketId")
  @Header("Cache-Control", "private, no-store")
  detail(@Param("ticketId", ParseUUIDPipe) ticketId: string) { return this.tickets.detailPlatform(ticketId); }

  @Post(":ticketId/messages")
  @Header("Cache-Control", "private, no-store")
  @RequirePlatformPermissions(PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsReply)
  @UseInterceptors(FilesInterceptor("files", MAX_SUPPORT_TICKET_ATTACHMENTS, { limits: { fileSize: MAX_SUPPORT_TICKET_ATTACHMENT_BYTES, files: MAX_SUPPORT_TICKET_ATTACHMENTS, fields: 1 } }))
  reply(@Req() request: AuthorizedRequest, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() input: CreateSupportTicketMessageDto, @UploadedFiles() files?: Express.Multer.File[]) {
    return this.tickets.replyPlatform(ticketId, request[AUTH_PRINCIPAL]!.userId, input, files);
  }

  @Get(":ticketId/attachments/:attachmentId/content")
  async attachment(@Param("ticketId", ParseUUIDPipe) ticketId: string, @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.tickets.streamPlatformAttachment(ticketId, attachmentId);
    response.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    return new StreamableFile(file.body, { type: file.contentType, length: file.contentLength, disposition: attachmentContentDisposition(file.originalFilename) });
  }

  @Patch(":ticketId")
  @Header("Cache-Control", "private, no-store")
  @RequirePlatformPermissions(PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsManage)
  manage(@Req() request: AuthorizedRequest, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() input: UpdateSupportTicketDto) {
    return this.tickets.manage(ticketId, request[AUTH_PRINCIPAL]!.userId, input);
  }
}
