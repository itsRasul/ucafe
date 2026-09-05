import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { MediaModule } from "../media/media.module";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { MenuCategory, MenuItem, MenuItemVariant } from "./entities";
import { MenuService } from "./menu.service";
import { PlatformMenuController } from "./platform-menu.controller";
import { PublicMenuController } from "./public-menu.controller";
import { TenantMenuController } from "./tenant-menu.controller";

@Module({
  imports: [TypeOrmModule.forFeature([MenuCategory, MenuItem, MenuItemVariant]), AuthModule, AuthorizationModule, MediaModule],
  controllers: [PublicMenuController, TenantMenuController, PlatformMenuController],
  providers: [MenuService, TenantContextGuard, PublicTenantAvailableGuard],
})
export class MenuModule {}
