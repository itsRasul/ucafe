import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { PlatformAuditController } from "./platform-audit.controller";
import { PlatformAuditService } from "./platform-audit.service";

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [PlatformAuditController],
  providers: [PlatformAuditService],
  exports: [PlatformAuditService],
})
export class AuditModule {}
