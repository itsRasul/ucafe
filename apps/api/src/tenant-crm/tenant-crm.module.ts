import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantCrmController } from "./tenant-crm.controller";
import { TenantCrmService } from "./tenant-crm.service";
import { TenantCrmResourcesController } from "./tenant-crm-resources.controller";

@Module({
  imports: [AuthModule, AuthorizationModule, SubscriptionsModule],
  controllers: [TenantCrmController, TenantCrmResourcesController],
  providers: [TenantContextGuard, TenantPermissionGuard, TenantCrmService],
})
export class TenantCrmModule {}
