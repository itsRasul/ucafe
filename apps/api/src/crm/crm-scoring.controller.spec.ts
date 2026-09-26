import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { PLATFORM_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CrmScoringController } from "./crm-scoring.controller";

test("scoring endpoints require platform guards and CRM permissions", () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, CrmScoringController), [AccessTokenGuard, PlatformPermissionGuard]);
  const required: Record<string, string[]> = {
    listRules: [PlatformPermissions.CrmRead],
    createRule: [PlatformPermissions.CrmManage],
    updateRule: [PlatformPermissions.CrmManage],
    archiveRule: [PlatformPermissions.CrmManage],
    preview: [PlatformPermissions.CrmRead],
    score: [PlatformPermissions.CrmRead],
    recalculateLead: [PlatformPermissions.CrmManage],
    recalculateActiveLeads: [PlatformPermissions.CrmManage],
  };
  for (const [method, permissions] of Object.entries(required)) {
    assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, CrmScoringController.prototype[method as keyof CrmScoringController]), permissions, method);
  }
});
