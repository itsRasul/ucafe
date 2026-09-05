import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateMenuCategoryDto, UpdateMenuCategoryDto } from "./dto/menu-category.dto";
import { CreateMenuItemDto, UpdateMenuItemDto } from "./dto/menu-item.dto";
import { MenuService } from "./menu.service";
import { MediaService } from "../media/media.service";
import { UpdateMediaDto, UploadMenuItemImageDto } from "../media/dto/media.dto";
import { MAX_MEDIA_BYTES } from "../media/media-image.util";

@Controller("tenant/menu")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
export class TenantMenuController {
  constructor(private readonly menu: MenuService, private readonly media: MediaService) {}
  private tenantId(request: TenantContextRequest) { return request[TENANT_CONTEXT]!.coffeeShopId; }

  @Get() @RequireTenantPermissions(TenantPermissions.MenuRead)
  get(@Req() request: TenantContextRequest) { return this.menu.getMenu(this.tenantId(request), false); }

  @Post("categories") @RequireTenantPermissions(TenantPermissions.MenuManage)
  createCategory(@Req() request: TenantContextRequest, @Body() input: CreateMenuCategoryDto) { return this.menu.createCategory(this.tenantId(request), input); }

  @Patch("categories/:categoryId") @RequireTenantPermissions(TenantPermissions.MenuManage)
  updateCategory(@Req() request: TenantContextRequest, @Param("categoryId") categoryId: string, @Body() input: UpdateMenuCategoryDto) { return this.menu.updateCategory(this.tenantId(request), categoryId, input); }

  @Delete("categories/:categoryId") @RequireTenantPermissions(TenantPermissions.MenuManage)
  deleteCategory(@Req() request: TenantContextRequest, @Param("categoryId") categoryId: string) { return this.menu.deleteCategory(this.tenantId(request), categoryId); }

  @Post("items") @RequireTenantPermissions(TenantPermissions.MenuManage)
  createItem(@Req() request: TenantContextRequest, @Body() input: CreateMenuItemDto) { return this.menu.createItem(this.tenantId(request), input); }

  @Patch("items/:itemId") @RequireTenantPermissions(TenantPermissions.MenuManage)
  updateItem(@Req() request: TenantContextRequest, @Param("itemId") itemId: string, @Body() input: UpdateMenuItemDto) { return this.menu.updateItem(this.tenantId(request), itemId, input); }

  @Delete("items/:itemId") @RequireTenantPermissions(TenantPermissions.MenuManage)
  deleteItem(@Req() request: TenantContextRequest, @Param("itemId") itemId: string) { return this.menu.deleteItem(this.tenantId(request), itemId); }

  @Post("items/:itemId/image") @RequireTenantPermissions(TenantPermissions.MenuManage)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_MEDIA_BYTES, files: 1, fields: 2 } }))
  uploadItemImage(@Req() request: TenantContextRequest, @Param("itemId", ParseUUIDPipe) itemId: string, @Body() input: UploadMenuItemImageDto, @UploadedFile() file?: Express.Multer.File) { return this.media.uploadMenuItemImage(this.tenantId(request), itemId, input, file); }

  @Patch("items/:itemId/image") @RequireTenantPermissions(TenantPermissions.MenuManage)
  updateItemImage(@Req() request: TenantContextRequest, @Param("itemId", ParseUUIDPipe) itemId: string, @Body() input: UpdateMediaDto) { return this.media.updateMenuItemImage(this.tenantId(request), itemId, input); }

  @Delete("items/:itemId/image") @HttpCode(204) @RequireTenantPermissions(TenantPermissions.MenuManage)
  removeItemImage(@Req() request: TenantContextRequest, @Param("itemId", ParseUUIDPipe) itemId: string) { return this.media.removeMenuItemImage(this.tenantId(request), itemId); }
}
