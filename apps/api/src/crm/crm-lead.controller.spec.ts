import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { PLATFORM_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CrmLeadController } from "./crm-lead.controller";

test("Lead endpoints require platform guards and CRM permissions per operation", () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, CrmLeadController), [AccessTokenGuard, PlatformPermissionGuard]);
  const required: Record<string, string[]> = {
    list: [PlatformPermissions.CrmRead],
    duplicateCandidates: [PlatformPermissions.CrmRead],
    get: [PlatformPermissions.CrmRead],
    assignees: [PlatformPermissions.CrmRead],
    create: [PlatformPermissions.CrmManage],
    update: [PlatformPermissions.CrmManage],
    changeStatus: [PlatformPermissions.CrmManage],
    qualify: [PlatformPermissions.CrmManage],
    unqualify: [PlatformPermissions.CrmManage],
    convert: [PlatformPermissions.CrmManage],
    archive: [PlatformPermissions.CrmManage],
    restore: [PlatformPermissions.CrmManage],
  };
  for (const [method, permissions] of Object.entries(required)) {
    assert.deepEqual(
      Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, CrmLeadController.prototype[method as keyof CrmLeadController]),
      permissions,
      method,
    );
  }
});
