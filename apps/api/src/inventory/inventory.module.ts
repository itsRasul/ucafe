import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";

@Module({imports:[AuthModule,AuthorizationModule,SubscriptionsModule],controllers:[InventoryController],providers:[InventoryService,TenantContextGuard]})
export class InventoryModule {}
