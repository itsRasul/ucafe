import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantCrmController } from "./tenant-crm.controller";
import { TenantCrmService } from "./tenant-crm.service";
import { TenantCrmResourcesController } from "./tenant-crm-resources.controller";
import { TenantCrmSegmentsController } from "./tenant-crm-segments.controller";
import { TenantCrmSegmentsService } from "./tenant-crm-segments.service";

@Module({
  imports: [AuthModule, AuthorizationModule, SubscriptionsModule],
  controllers: [TenantCrmController, TenantCrmResourcesController, TenantCrmSegmentsController],
  providers: [TenantContextGuard, TenantPermissionGuard, TenantCrmService, TenantCrmSegmentsService],
})
export class TenantCrmModule {}
