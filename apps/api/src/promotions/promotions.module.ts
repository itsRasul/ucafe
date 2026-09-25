import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { MenuCategory, MenuItem } from "../menu/entities";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { Promotion, PromotionTarget } from "./entities";
import { PromotionPricingService } from "./promotion-pricing.service";
import { PromotionsService } from "./promotions.service";
import { TenantPromotionsController } from "./tenant-promotions.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Promotion, PromotionTarget, MenuItem, MenuCategory]), AuthModule, AuthorizationModule],
  controllers: [TenantPromotionsController],
  providers: [PromotionsService, PromotionPricingService, AccessTokenGuard, TenantContextGuard, TenantPermissionGuard],
  exports: [PromotionPricingService],
})
export class PromotionsModule {}
