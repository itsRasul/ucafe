import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Req, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { isMediaVariant } from "./media-image.util";
import { MediaService } from "./media.service";

@Controller("public/media")
@UseGuards(TenantContextGuard, PublicTenantAvailableGuard)
export class PublicMediaController {
  constructor(private readonly media: MediaService) {}
  @Get(":id/:variant")
  async get(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string, @Param("variant") variant: string, @Res() response: Response) {
    if (!isMediaVariant(variant)) throw new NotFoundException("Media variant not found");
    const object = await this.media.stream(request[TENANT_CONTEXT]!.coffeeShopId, id, variant);
    response.set({ "Content-Type": object.contentType, "Cache-Control": "public, max-age=31536000, immutable", ...(object.contentLength ? { "Content-Length": String(object.contentLength) } : {}), ...(object.etag ? { ETag: object.etag } : {}) });
    object.body.on("error", () => { if (!response.headersSent) response.sendStatus(502); else response.destroy(); });
    object.body.pipe(response);
  }
}
