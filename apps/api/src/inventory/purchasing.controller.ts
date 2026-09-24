import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissions } from "../authorization/permission.constants";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateGoodsReceiptDto, CreatePurchaseOrderDto, CreateSupplierDto, PostGoodsReceiptDto, PurchasingListQueryDto, UpdateGoodsReceiptDto, UpdatePurchaseOrderDto, UpdateSupplierDto } from "./purchasing.dto";
import { PurchasingService } from "./purchasing.service";

@Controller("tenant/inventory")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}
  private tenant(req: TenantContextRequest) { return req[TENANT_CONTEXT]!.coffeeShopId; }

  @Get("suppliers") @RequireTenantPermissions(TenantPermissions.InventoryRead)
  suppliers(@Req() req: TenantContextRequest, @Query() query: PurchasingListQueryDto) { return this.purchasing.suppliers(this.tenant(req), query); }
  @Get("suppliers/:id/prices") @RequireTenantPermissions(TenantPermissions.InventoryRead)
  supplierPrices(@Req() req: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string, @Query() query: PurchasingListQueryDto) { return this.purchasing.supplierPrices(this.tenant(req), id, query); }
  @Post("suppliers") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  createSupplier(@Req() req: TenantContextRequest, @Body() input: CreateSupplierDto) { return this.purchasing.createSupplier(this.tenant(req), input); }
  @Patch("suppliers/:id") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  updateSupplier(@Req() req: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateSupplierDto) { return this.purchasing.updateSupplier(this.tenant(req), id, input); }

  @Get("purchase-orders") @RequireTenantPermissions(TenantPermissions.InventoryRead)
  purchaseOrders(@Req() req: TenantContextRequest, @Query() query: PurchasingListQueryDto) { return this.purchasing.purchaseOrders(this.tenant(req), query); }
  @Get("purchase-orders/:id") @RequireTenantPermissions(TenantPermissions.InventoryRead)
  purchaseOrder(@Req() req: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string) { return this.purchasing.purchaseOrder(this.tenant(req), id); }
  @Post("purchase-orders") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  createPurchaseOrder(@Req() req: TenantContextRequest & AuthorizedRequest, @Body() input: CreatePurchaseOrderDto) { return this.purchasing.createPurchaseOrder(this.tenant(req), req[AUTH_PRINCIPAL]!.userId, input); }
  @Patch("purchase-orders/:id") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  updatePurchaseOrder(@Req() req: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdatePurchaseOrderDto) { return this.purchasing.updatePurchaseOrder(this.tenant(req), id, input); }
  @Post("purchase-orders/:id/order") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  orderPurchaseOrder(@Req() req: TenantContextRequest & AuthorizedRequest, @Param("id", ParseUUIDPipe) id: string) { return this.purchasing.orderPurchaseOrder(this.tenant(req), req[AUTH_PRINCIPAL]!.userId, id); }
  @Post("purchase-orders/:id/cancel") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  cancelPurchaseOrder(@Req() req: TenantContextRequest & AuthorizedRequest, @Param("id", ParseUUIDPipe) id: string) { return this.purchasing.cancelPurchaseOrder(this.tenant(req), req[AUTH_PRINCIPAL]!.userId, id); }

  @Get("goods-receipts") @RequireTenantPermissions(TenantPermissions.InventoryRead)
  goodsReceipts(@Req() req: TenantContextRequest, @Query() query: PurchasingListQueryDto) { return this.purchasing.goodsReceipts(this.tenant(req), query); }
  @Get("goods-receipts/:id") @RequireTenantPermissions(TenantPermissions.InventoryRead)
  goodsReceipt(@Req() req: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string) { return this.purchasing.goodsReceipt(this.tenant(req), id); }
  @Post("goods-receipts") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  createGoodsReceipt(@Req() req: TenantContextRequest & AuthorizedRequest, @Body() input: CreateGoodsReceiptDto) { return this.purchasing.createGoodsReceipt(this.tenant(req), req[AUTH_PRINCIPAL]!.userId, input); }
  @Patch("goods-receipts/:id") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  updateGoodsReceipt(@Req() req: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateGoodsReceiptDto) { return this.purchasing.updateGoodsReceipt(this.tenant(req), id, input); }
  @Post("goods-receipts/:id/post") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  postGoodsReceipt(@Req() req: TenantContextRequest & AuthorizedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() input: PostGoodsReceiptDto) { return this.purchasing.postGoodsReceipt(this.tenant(req), req[AUTH_PRINCIPAL]!.userId, id, input.allowOverReceive === true); }
}
