import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { PLATFORM_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CrmWorkController } from "./crm-work.controller";

test("CRM work routes require authentication and the correct CRM permission", () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, CrmWorkController), [AccessTokenGuard, PlatformPermissionGuard]);
  const read = [PlatformPermissions.CrmRead];
  const manage = [PlatformPermissions.CrmManage];
  const required: Record<string, string[]> = {
    listActivities: read, getActivity: read, createActivity: manage, updateActivity: manage, archiveActivity: manage, restoreActivity: manage,
    listTasks: read, getTask: read, createTask: manage, updateTask: manage, completeTask: manage, cancelTask: manage, reopenTask: manage, archiveTask: manage, restoreTask: manage,
    listNotes: read, getNote: read, createNote: manage, updateNote: manage, archiveNote: manage, restoreNote: manage,
  };
  for (const [method, permissions] of Object.entries(required)) {
    assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, CrmWorkController.prototype[method as keyof CrmWorkController]), permissions, method);
  }
});
