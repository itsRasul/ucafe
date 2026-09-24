import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  imports: [AuthModule, AuthorizationModule, SubscriptionsModule, InventoryModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, TenantContextGuard],
})
export class AnalyticsModule {}
