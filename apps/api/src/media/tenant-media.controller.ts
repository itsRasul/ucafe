import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { UpdateMediaDto, UploadMediaDto } from "./dto/media.dto";
import { MAX_MEDIA_BYTES } from "./media-image.util";
import { MediaService } from "./media.service";

@Controller("tenant/media")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.SiteManage)
export class TenantMediaController {
  constructor(private readonly media: MediaService) {}
  @Get() list(@Req() request: TenantContextRequest) { return this.media.list(request[TENANT_CONTEXT]!.coffeeShopId); }
  @Post() @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_MEDIA_BYTES, files: 1, fields: 3 } })) upload(@Req() request: TenantContextRequest, @Body() input: UploadMediaDto, @UploadedFile() file?: Express.Multer.File) { return this.media.upload(request[TENANT_CONTEXT]!.coffeeShopId, input, file); }
  @Patch(":id") update(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateMediaDto) { return this.media.update(request[TENANT_CONTEXT]!.coffeeShopId, id, input); }
  @Delete(":id") @HttpCode(204) remove(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string) { return this.media.remove(request[TENANT_CONTEXT]!.coffeeShopId, id); }
}
