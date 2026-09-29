import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { MediaModule } from "../media/media.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { SupportTicketNotificationsService } from "./support-ticket-notifications.service";
import { TenantSupportTicketsController } from "./tenant-support-tickets.controller";
import { PlatformSupportTicketsController } from "./platform-support-tickets.controller";
import { SupportTicketsService } from "./support-tickets.service";

@Module({
  imports: [AuthModule, AuthorizationModule, AuditModule, MediaModule, NotificationsModule],
  controllers: [TenantSupportTicketsController, PlatformSupportTicketsController],
  providers: [TenantContextGuard, SupportTicketsService, SupportTicketNotificationsService],
})
export class SupportTicketsModule {}
