import { Module } from "@nestjs/common";
import { IdentityAccessModule } from "../identity/identity-access.module";
import { AuthorizationService } from "./authorization.service";
import { PlatformPermissionGuard } from "./platform-permission.guard";
import { PlatformBootstrapService } from "./platform-bootstrap.service";
import { TenantPermissionGuard } from "./tenant-permission.guard";

@Module({
  imports: [IdentityAccessModule],
  providers: [AuthorizationService, PlatformBootstrapService, PlatformPermissionGuard, TenantPermissionGuard],
  exports: [AuthorizationService, PlatformBootstrapService, PlatformPermissionGuard, TenantPermissionGuard],
})
export class AuthorizationModule {}
