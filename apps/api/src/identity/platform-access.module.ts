import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { PlatformAccessController } from "./platform-access.controller";
import { PlatformAccessService } from "./platform-access.service";

@Module({
  imports: [AuthModule, AuthorizationModule, AuditModule],
  controllers: [PlatformAccessController],
  providers: [PlatformAccessService],
})
export class PlatformAccessModule {}
