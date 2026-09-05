import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { Branch, CoffeeShop } from "../database/entities";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { BranchOpeningHour, WebsiteSettings } from "./entities";
import { PlatformSiteController } from "./platform-site.controller";
import { PublicSiteController } from "./public-site.controller";
import { SiteService } from "./site.service";
import { TenantSiteController } from "./tenant-site.controller";
import { MediaModule } from "../media/media.module";

@Module({
  imports: [TypeOrmModule.forFeature([CoffeeShop, Branch, WebsiteSettings, BranchOpeningHour]), AuthModule, AuthorizationModule, MediaModule],
  controllers: [PublicSiteController, TenantSiteController, PlatformSiteController],
  providers: [SiteService, TenantContextGuard, PublicTenantAvailableGuard],
  exports: [SiteService],
})
export class SiteModule {}
