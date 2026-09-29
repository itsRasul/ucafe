import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { TenantSupportTicketsController } from "./tenant-support-tickets.controller";
import { PlatformSupportTicketsController } from "./platform-support-tickets.controller";
import { SupportTicketsService } from "./support-tickets.service";

@Module({
  imports: [AuthModule, AuthorizationModule, AuditModule],
  controllers: [TenantSupportTicketsController, PlatformSupportTicketsController],
  providers: [TenantContextGuard, SupportTicketsService],
})
export class SupportTicketsModule {}
