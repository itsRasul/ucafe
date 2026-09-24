import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissions } from "../authorization/permission.constants";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateInventoryCategoryDto, CreateInventoryItemDto, CreateInventoryLocationDto, CreateStockCountDto, CreateWasteRecordDto, InventoryListQueryDto, InventoryStockSettingsDto, MovementListQueryDto, StockAdjustmentDto, StockAlertListQueryDto, UpdateInventoryCategoryDto, UpdateInventoryItemDto, UpdateInventoryLocationDto, UpdateStockCountLinesDto, UpdateWasteRecordDto, WasteListQueryDto } from "./inventory.dto";
import { InventoryService } from "./inventory.service";

@Controller("tenant/inventory")
@UseGuards(AccessTokenGuard,TenantContextGuard,TenantPermissionGuard)
export class InventoryController {
  constructor(private readonly inventory:InventoryService){}
  private tenant(req:TenantContextRequest){return req[TENANT_CONTEXT]!.coffeeShopId;}
  @Get("overview") @RequireTenantPermissions(TenantPermissions.InventoryRead) overview(@Req() req:TenantContextRequest){return this.inventory.overview(this.tenant(req));}
  @Get("categories") @RequireTenantPermissions(TenantPermissions.InventoryRead) categories(@Req() req:TenantContextRequest){return this.inventory.categories(this.tenant(req));}
  @Post("categories") @RequireTenantPermissions(TenantPermissions.InventoryManage) createCategory(@Req() req:TenantContextRequest,@Body() input:CreateInventoryCategoryDto){return this.inventory.createCategory(this.tenant(req),input);}
  @Patch("categories/:id") @RequireTenantPermissions(TenantPermissions.InventoryManage) updateCategory(@Req() req:TenantContextRequest,@Param("id",ParseUUIDPipe) id:string,@Body() input:UpdateInventoryCategoryDto){return this.inventory.updateCategory(this.tenant(req),id,input);}
  @Get("locations") @RequireTenantPermissions(TenantPermissions.InventoryRead) locations(@Req() req:TenantContextRequest){return this.inventory.locations(this.tenant(req));}
  @Post("locations") @RequireTenantPermissions(TenantPermissions.InventoryManage) createLocation(@Req() req:TenantContextRequest,@Body() input:CreateInventoryLocationDto){return this.inventory.createLocation(this.tenant(req),input);}
  @Patch("locations/:id") @RequireTenantPermissions(TenantPermissions.InventoryManage) updateLocation(@Req() req:TenantContextRequest,@Param("id",ParseUUIDPipe) id:string,@Body() input:UpdateInventoryLocationDto){return this.inventory.updateLocation(this.tenant(req),id,input);}
  @Get("items") @RequireTenantPermissions(TenantPermissions.InventoryRead) items(@Req() req:TenantContextRequest,@Query() query:InventoryListQueryDto){return this.inventory.items(this.tenant(req),query);}
  @Post("items") @RequireTenantPermissions(TenantPermissions.InventoryManage) createItem(@Req() req:TenantContextRequest & AuthorizedRequest,@Body() input:CreateInventoryItemDto){return this.inventory.createItem(this.tenant(req),req[AUTH_PRINCIPAL]!.userId,input);}
  @Patch("items/:id") @RequireTenantPermissions(TenantPermissions.InventoryManage) updateItem(@Req() req:TenantContextRequest,@Param("id",ParseUUIDPipe) id:string,@Body() input:UpdateInventoryItemDto){return this.inventory.updateItem(this.tenant(req),id,input);}
  @Get("stock") @RequireTenantPermissions(TenantPermissions.InventoryRead) stock(@Req() req:TenantContextRequest,@Query() query:InventoryListQueryDto){return this.inventory.stock(this.tenant(req),query);}
  @Patch("items/:id/stock-settings") @RequireTenantPermissions(TenantPermissions.InventoryManage) stockSettings(@Req() req:TenantContextRequest,@Param("id",ParseUUIDPipe) id:string,@Body() input:InventoryStockSettingsDto){return this.inventory.updateStockSettings(this.tenant(req),id,input);}
  @Get("stock-alerts") @RequireTenantPermissions(TenantPermissions.InventoryRead) stockAlerts(@Req() req:TenantContextRequest,@Query() query:StockAlertListQueryDto){return this.inventory.stockAlerts(this.tenant(req),query);}
  @Get("waste") @RequireTenantPermissions(TenantPermissions.InventoryRead) wasteRecords(@Req() req:TenantContextRequest,@Query() query:WasteListQueryDto){return this.inventory.wasteRecords(this.tenant(req),query);}
  @Post("waste") @RequireTenantPermissions(TenantPermissions.InventoryManage) createWasteRecord(@Req() req:TenantContextRequest & AuthorizedRequest,@Body() input:CreateWasteRecordDto){return this.inventory.createWasteRecord(this.tenant(req),req[AUTH_PRINCIPAL]!.userId,input);}
  @Get("waste/:id") @RequireTenantPermissions(TenantPermissions.InventoryRead) wasteRecord(@Req() req:TenantContextRequest,@Param("id",ParseUUIDPipe) id:string){return this.inventory.wasteRecord(this.tenant(req),id);}
  @Patch("waste/:id") @RequireTenantPermissions(TenantPermissions.InventoryManage) updateWasteRecord(@Req() req:TenantContextRequest,@Param("id",ParseUUIDPipe) id:string,@Body() input:UpdateWasteRecordDto){return this.inventory.updateWasteRecord(this.tenant(req),id,input);}
  @Post("waste/:id/post") @RequireTenantPermissions(TenantPermissions.InventoryManage) postWasteRecord(@Req() req:TenantContextRequest & AuthorizedRequest,@Param("id",ParseUUIDPipe) id:string){return this.inventory.postWasteRecord(this.tenant(req),req[AUTH_PRINCIPAL]!.userId,id);}
  @Post("waste/:id/reverse") @RequireTenantPermissions(TenantPermissions.InventoryManage) reverseWasteRecord(@Req() req:TenantContextRequest & AuthorizedRequest,@Param("id",ParseUUIDPipe) id:string){return this.inventory.reverseWasteRecord(this.tenant(req),req[AUTH_PRINCIPAL]!.userId,id);}
  @Post("adjustments") @RequireTenantPermissions(TenantPermissions.InventoryManage) adjust(@Req() req:TenantContextRequest & AuthorizedRequest,@Body() input:StockAdjustmentDto){return this.inventory.adjust(this.tenant(req),req[AUTH_PRINCIPAL]!.userId,input);}
  @Get("movements") @RequireTenantPermissions(TenantPermissions.InventoryRead) movements(@Req() req:TenantContextRequest,@Query() query:MovementListQueryDto){return this.inventory.movements(this.tenant(req),query);}
  @Get("counts") @RequireTenantPermissions(TenantPermissions.InventoryRead) counts(@Req() req:TenantContextRequest,@Query() query:InventoryListQueryDto){return this.inventory.counts(this.tenant(req),query);}
  @Post("counts") @RequireTenantPermissions(TenantPermissions.InventoryManage) createCount(@Req() req:TenantContextRequest & AuthorizedRequest,@Body() input:CreateStockCountDto){return this.inventory.createCount(this.tenant(req),req[AUTH_PRINCIPAL]!.userId,input);}
  @Get("counts/:id") @RequireTenantPermissions(TenantPermissions.InventoryRead) countDetail(@Req() req:TenantContextRequest,@Param("id",ParseUUIDPipe) id:string){return this.inventory.countDetail(this.tenant(req),id);}
  @Patch("counts/:id/lines") @RequireTenantPermissions(TenantPermissions.InventoryManage) saveCountLines(@Req() req:TenantContextRequest,@Param("id",ParseUUIDPipe) id:string,@Body() input:UpdateStockCountLinesDto){return this.inventory.saveCountLines(this.tenant(req),id,input);}
  @Post("counts/:id/complete") @RequireTenantPermissions(TenantPermissions.InventoryManage) completeCount(@Req() req:TenantContextRequest & AuthorizedRequest,@Param("id",ParseUUIDPipe) id:string){return this.inventory.completeCount(this.tenant(req),req[AUTH_PRINCIPAL]!.userId,id);}
}
