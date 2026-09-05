import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { CoffeeShop } from "../database/entities";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { MediaAsset } from "./entities";
import { MediaService } from "./media.service";
import { MediaStorageService } from "./media-storage.service";
import { PlatformMediaController } from "./platform-media.controller";
import { PublicMediaController } from "./public-media.controller";
import { TenantMediaController } from "./tenant-media.controller";

@Module({
  imports: [TypeOrmModule.forFeature([CoffeeShop, MediaAsset]), AuthModule, AuthorizationModule],
  controllers: [TenantMediaController, PlatformMediaController, PublicMediaController],
  providers: [MediaService, MediaStorageService, TenantContextGuard, PublicTenantAvailableGuard],
  exports: [MediaService, MediaStorageService],
})
export class MediaModule {}
