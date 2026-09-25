import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { OtpChallenge } from "../auth/entities";
import { ClientAccessTokenGuard } from "./client-access-token.guard";
import { ClientAddressesController } from "./client-addresses.controller";
import { ClientAuthController } from "./client-auth.controller";
import { ClientAuthService } from "./client-auth.service";
import { ClientPanelController } from "./client-panel.controller";
import { CustomerSegmentsController } from "./customer-segments.controller";
import { CustomerSegmentsService } from "./customer-segments.service";
import { ClientsService } from "./clients.service";
import { Client, ClientAddress, ClientAuthSession, CustomerSegment, CustomerSegmentMembership } from "./entities";
import { AuthorizationModule } from "../authorization/authorization.module";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";

@Module({
  imports: [TypeOrmModule.forFeature([Client, ClientAddress, ClientAuthSession, CustomerSegment, CustomerSegmentMembership, OtpChallenge]), AuthModule, AuthorizationModule],
  controllers: [ClientAuthController, ClientAddressesController, ClientPanelController, CustomerSegmentsController],
  providers: [ClientsService, ClientAuthService, ClientAccessTokenGuard, CustomerSegmentsService, AccessTokenGuard, TenantContextGuard, TenantPermissionGuard],
  exports: [ClientsService, ClientAccessTokenGuard, TypeOrmModule],
})
export class ClientsModule {}
