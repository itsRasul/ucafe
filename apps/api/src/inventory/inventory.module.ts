import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { RecipesController } from "./recipes.controller";
import { RecipesService } from "./recipes.service";
import { PurchasingController } from "./purchasing.controller";
import { PurchasingService } from "./purchasing.service";
import { CostingController } from "./costing.controller";
import { RecipeCostingService } from "./costing.service";
import { InventoryVarianceService } from "./variance.service";

@Module({imports:[AuthModule,AuthorizationModule,SubscriptionsModule],controllers:[InventoryController,RecipesController,CostingController,PurchasingController],providers:[InventoryService,RecipesService,RecipeCostingService,PurchasingService,InventoryVarianceService,TenantContextGuard],exports:[InventoryService,InventoryVarianceService]})
export class InventoryModule {}
