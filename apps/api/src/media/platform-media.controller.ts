import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Res, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { UpdateMediaDto, UploadMediaDto } from "./dto/media.dto";
import { isMediaVariant, MAX_MEDIA_BYTES } from "./media-image.util";
import { MediaService } from "./media.service";

@Controller("platform/tenants/:coffeeShopId/media")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
@RequirePlatformPermissions(PlatformPermissions.TenantsUpdate)
export class PlatformMediaController {
  constructor(private readonly media: MediaService) {}
  @Get() list(@Param("coffeeShopId", ParseUUIDPipe) id: string) { return this.media.list(id); }
  @Get(":assetId/:variant")
  async preview(@Param("coffeeShopId", ParseUUIDPipe) id: string, @Param("assetId", ParseUUIDPipe) assetId: string, @Param("variant") variant: string, @Res() response: Response) {
    if (!isMediaVariant(variant)) throw new NotFoundException("Media variant not found");
    const object = await this.media.stream(id, assetId, variant);
    response.set({ "Content-Type": object.contentType, "Cache-Control": "private, no-store" });
    object.body.on("error", () => { if (!response.headersSent) response.sendStatus(502); else response.destroy(); });
    object.body.pipe(response);
  }
  @Post() @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_MEDIA_BYTES, files: 1, fields: 3 } })) upload(@Param("coffeeShopId", ParseUUIDPipe) id: string, @Body() input: UploadMediaDto, @UploadedFile() file?: Express.Multer.File) { return this.media.upload(id, input, file); }
  @Patch(":assetId") update(@Param("coffeeShopId", ParseUUIDPipe) id: string, @Param("assetId", ParseUUIDPipe) assetId: string, @Body() input: UpdateMediaDto) { return this.media.update(id, assetId, input); }
  @Delete(":assetId") @HttpCode(204) remove(@Param("coffeeShopId", ParseUUIDPipe) id: string, @Param("assetId", ParseUUIDPipe) assetId: string) { return this.media.remove(id, assetId); }
}
