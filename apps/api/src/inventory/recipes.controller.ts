import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { RecipeTargetDto, ReplaceRecipeComponentsDto } from "./recipes.dto";
import { RecipesService } from "./recipes.service";

@Controller("tenant/inventory/recipes")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}
  private tenant(request: TenantContextRequest) { return request[TENANT_CONTEXT]!.coffeeShopId; }

  @Get() @RequireTenantPermissions(TenantPermissions.InventoryRead)
  list(@Req() request: TenantContextRequest) { return this.recipes.list(this.tenant(request)); }

  @Get(":id") @RequireTenantPermissions(TenantPermissions.InventoryRead)
  get(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string) { return this.recipes.get(this.tenant(request), id); }

  @Post() @RequireTenantPermissions(TenantPermissions.InventoryManage)
  create(@Req() request: TenantContextRequest & AuthorizedRequest, @Body() input: RecipeTargetDto) { return this.recipes.create(this.tenant(request), request[AUTH_PRINCIPAL]!.userId, input); }

  @Post(":id/versions") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  createVersion(@Req() request: TenantContextRequest & AuthorizedRequest, @Param("id", ParseUUIDPipe) id: string) { return this.recipes.createVersion(this.tenant(request), request[AUTH_PRINCIPAL]!.userId, id); }

  @Patch(":id/versions/:versionId/components") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  replaceComponents(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string, @Param("versionId", ParseUUIDPipe) versionId: string, @Body() input: ReplaceRecipeComponentsDto) { return this.recipes.replaceComponents(this.tenant(request), id, versionId, input); }

  @Post(":id/versions/:versionId/publish") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  publish(@Req() request: TenantContextRequest & AuthorizedRequest, @Param("id", ParseUUIDPipe) id: string, @Param("versionId", ParseUUIDPipe) versionId: string) { return this.recipes.publish(this.tenant(request), request[AUTH_PRINCIPAL]!.userId, id, versionId); }

  @Post(":id/duplicate") @RequireTenantPermissions(TenantPermissions.InventoryManage)
  duplicate(@Req() request: TenantContextRequest & AuthorizedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() target: RecipeTargetDto) { return this.recipes.duplicate(this.tenant(request), request[AUTH_PRINCIPAL]!.userId, id, target); }
}
