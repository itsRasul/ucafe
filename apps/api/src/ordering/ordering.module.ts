import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { ClientsModule } from "../clients/clients.module";
import { Branch } from "../database/entities";
import { MenuCategory, MenuItem, MenuItemVariant } from "../menu/entities";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { InventoryModule } from "../inventory/inventory.module";
import { OnlineOrderingSettings, Order, OrderItem } from "./entities";
import { OrderingService } from "./ordering.service";
import { PublicOrderingController } from "./public-ordering.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { TenantOrderingController } from "./tenant-ordering.controller";

@Module({
  imports: [NotificationsModule, InventoryModule, TypeOrmModule.forFeature([OnlineOrderingSettings, Order, OrderItem, Branch, MenuCategory, MenuItem, MenuItemVariant]), AuthModule, AuthorizationModule, ClientsModule, SubscriptionsModule],
  controllers: [PublicOrderingController, TenantOrderingController],
  providers: [OrderingService, TenantContextGuard, PublicTenantAvailableGuard],
  exports: [OrderingService],
})
export class OrderingModule {}
