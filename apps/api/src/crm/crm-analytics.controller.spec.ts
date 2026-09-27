import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { PLATFORM_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CrmAnalyticsController } from "./crm-analytics.controller";

test("CRM Analytics handlers require CRM access; customer aggregates also require subscription access", () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, CrmAnalyticsController), [AccessTokenGuard, PlatformPermissionGuard]);
  const customer = CrmAnalyticsController.prototype.customers;
  assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, customer), [PlatformPermissions.CrmRead, PlatformPermissions.SubscriptionsRead]);
  for (const handler of ["overview", "funnel", "pipeline", "sources", "work", "owners", "scoring", "automation"] as const) {
    assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, CrmAnalyticsController.prototype[handler]), [PlatformPermissions.CrmRead], handler);
  }
});
