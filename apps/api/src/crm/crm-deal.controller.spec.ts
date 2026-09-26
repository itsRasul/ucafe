import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { PLATFORM_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CrmDealController } from "./crm-deal.controller";

test("Deal and pipeline endpoints require platform guards and CRM permissions", () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, CrmDealController), [AccessTokenGuard, PlatformPermissionGuard]);
  const required: Record<string, string[]> = {
    pipeline: [PlatformPermissions.CrmRead], planOptions: [PlatformPermissions.CrmRead], list: [PlatformPermissions.CrmRead], get: [PlatformPermissions.CrmRead],
    create: [PlatformPermissions.CrmManage], update: [PlatformPermissions.CrmManage], changeStage: [PlatformPermissions.CrmManage],
    win: [PlatformPermissions.CrmManage], lose: [PlatformPermissions.CrmManage], archive: [PlatformPermissions.CrmManage], restore: [PlatformPermissions.CrmManage],
  };
  for (const [method, permissions] of Object.entries(required)) {
    assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, CrmDealController.prototype[method as keyof CrmDealController]), permissions, method);
  }
});
