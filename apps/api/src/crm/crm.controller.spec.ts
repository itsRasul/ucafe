import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PLATFORM_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CrmController } from "./crm.controller";

test("every CRM handler is protected by both platform guards and explicit permissions", () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, CrmController), [AccessTokenGuard, PlatformPermissionGuard]);
  const expected: Record<string, string[]> = {
    listOrganizations: [PlatformPermissions.CrmRead],
    createOrganization: [PlatformPermissions.CrmManage],
    organizationDuplicates: [PlatformPermissions.CrmRead],
    tenantLinkCandidates: [PlatformPermissions.CrmRead, PlatformPermissions.TenantsRead],
    getOrganization: [PlatformPermissions.CrmRead],
    organizationOverview: [PlatformPermissions.CrmRead],
    organizationCustomerContext: [PlatformPermissions.CrmRead, PlatformPermissions.SubscriptionsRead],
    organizationTimeline: [PlatformPermissions.CrmRead, PlatformPermissions.SubscriptionsRead],
    updateOrganization: [PlatformPermissions.CrmManage],
    linkOrganizationTenant: [PlatformPermissions.CrmManage, PlatformPermissions.TenantsRead],
    unlinkOrganizationTenant: [PlatformPermissions.CrmManage, PlatformPermissions.TenantsRead],
    archiveOrganization: [PlatformPermissions.CrmManage],
    restoreOrganization: [PlatformPermissions.CrmManage],
    listOrganizationContacts: [PlatformPermissions.CrmRead],
    createContact: [PlatformPermissions.CrmManage],
    contactDuplicates: [PlatformPermissions.CrmRead],
    listContacts: [PlatformPermissions.CrmRead],
    getContact: [PlatformPermissions.CrmRead],
    updateContact: [PlatformPermissions.CrmManage],
    archiveContact: [PlatformPermissions.CrmManage],
    restoreContact: [PlatformPermissions.CrmManage],
  };
  for (const [handler, permissions] of Object.entries(expected)) {
    assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, CrmController.prototype[handler as keyof CrmController]), permissions, handler);
  }
});
