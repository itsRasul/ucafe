import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { PLATFORM_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CrmWorkflowController } from "./crm-workflow.controller";

test("workflow endpoints require platform guards and separate read/manage permissions", () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, CrmWorkflowController), [AccessTokenGuard, PlatformPermissionGuard]);
  const required: Record<string, string[]> = {
    list: [PlatformPermissions.CrmRead], get: [PlatformPermissions.CrmRead], executions: [PlatformPermissions.CrmRead], execution: [PlatformPermissions.CrmRead],
    create: [PlatformPermissions.CrmManage], update: [PlatformPermissions.CrmManage], archive: [PlatformPermissions.CrmManage], retry: [PlatformPermissions.CrmManage],
  };
  for (const [method, permissions] of Object.entries(required)) {
    assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, CrmWorkflowController.prototype[method as keyof CrmWorkflowController]), permissions, method);
  }
});
