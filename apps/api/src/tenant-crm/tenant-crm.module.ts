import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { ClientsModule } from "../clients/clients.module";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantCrmController } from "./tenant-crm.controller";
import { TenantCrmService } from "./tenant-crm.service";
import { TenantCrmResourcesController } from "./tenant-crm-resources.controller";
import { TenantCrmSegmentsController } from "./tenant-crm-segments.controller";
import { TenantCrmSegmentsService } from "./tenant-crm-segments.service";
import { TenantCrmLoyaltyController } from "./tenant-crm-loyalty.controller";
import { TenantCrmLoyaltyService } from "./tenant-crm-loyalty.service";
import { TenantCrmClientFeedbackController, TenantCrmFeedbackController } from "./tenant-crm-feedback.controller";
import { TenantCrmOffersController } from "./tenant-crm-offers.controller";
import { TenantCrmOffersService } from "./tenant-crm-offers.service";

@Module({
  imports: [AuthModule, AuthorizationModule, SubscriptionsModule, ClientsModule],
  controllers: [TenantCrmController, TenantCrmResourcesController, TenantCrmSegmentsController, TenantCrmLoyaltyController,
    TenantCrmFeedbackController, TenantCrmClientFeedbackController, TenantCrmOffersController],
  providers: [TenantContextGuard, TenantPermissionGuard, TenantCrmService, TenantCrmSegmentsService, TenantCrmLoyaltyService, TenantCrmOffersService],
})
export class TenantCrmModule {}
