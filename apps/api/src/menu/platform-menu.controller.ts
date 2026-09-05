import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CreateMenuCategoryDto, UpdateMenuCategoryDto } from "./dto/menu-category.dto";
import { CreateMenuItemDto, UpdateMenuItemDto } from "./dto/menu-item.dto";
import { MenuService } from "./menu.service";
import { MediaService } from "../media/media.service";
import { UpdateMediaDto, UploadMenuItemImageDto } from "../media/dto/media.dto";
import { MAX_MEDIA_BYTES } from "../media/media-image.util";

@Controller("platform/tenants/:coffeeShopId/menu")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
@RequirePlatformPermissions(PlatformPermissions.TenantsUpdate)
export class PlatformMenuController {
  constructor(private readonly menu: MenuService, private readonly media: MediaService) {}
  @Get() get(@Param("coffeeShopId") id: string) { return this.menu.getMenu(id, false); }
  @Post("categories") createCategory(@Param("coffeeShopId") id: string, @Body() input: CreateMenuCategoryDto) { return this.menu.createCategory(id, input); }
  @Patch("categories/:categoryId") updateCategory(@Param("coffeeShopId") id: string, @Param("categoryId") categoryId: string, @Body() input: UpdateMenuCategoryDto) { return this.menu.updateCategory(id, categoryId, input); }
  @Delete("categories/:categoryId") deleteCategory(@Param("coffeeShopId") id: string, @Param("categoryId") categoryId: string) { return this.menu.deleteCategory(id, categoryId); }
  @Post("items") createItem(@Param("coffeeShopId") id: string, @Body() input: CreateMenuItemDto) { return this.menu.createItem(id, input); }
  @Patch("items/:itemId") updateItem(@Param("coffeeShopId") id: string, @Param("itemId") itemId: string, @Body() input: UpdateMenuItemDto) { return this.menu.updateItem(id, itemId, input); }
  @Delete("items/:itemId") deleteItem(@Param("coffeeShopId") id: string, @Param("itemId") itemId: string) { return this.menu.deleteItem(id, itemId); }
  @Post("items/:itemId/image") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_MEDIA_BYTES, files: 1, fields: 2 } }))
  uploadItemImage(@Param("coffeeShopId", ParseUUIDPipe) id: string, @Param("itemId", ParseUUIDPipe) itemId: string, @Body() input: UploadMenuItemImageDto, @UploadedFile() file?: Express.Multer.File) { return this.media.uploadMenuItemImage(id, itemId, input, file); }
  @Patch("items/:itemId/image") updateItemImage(@Param("coffeeShopId", ParseUUIDPipe) id: string, @Param("itemId", ParseUUIDPipe) itemId: string, @Body() input: UpdateMediaDto) { return this.media.updateMenuItemImage(id, itemId, input); }
  @Delete("items/:itemId/image") @HttpCode(204) removeItemImage(@Param("coffeeShopId", ParseUUIDPipe) id: string, @Param("itemId", ParseUUIDPipe) itemId: string) { return this.media.removeMenuItemImage(id, itemId); }
}
