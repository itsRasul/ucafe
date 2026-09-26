import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { PLATFORM_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions as P } from "../authorization/permission.constants";
import { CrmMetadataController } from "./crm-metadata.controller";
import { CrmSavedViewController } from "./crm-saved-view.controller";
import { CrmSegmentController } from "./crm-segment.controller";

const read = [P.CrmRead];
const manage = [P.CrmManage];

test("Phase 7 CRM metadata, Saved View, and Segment routes enforce platform permission boundaries", () => {
  const groups = [
    [CrmMetadataController, { listFields: read, createField: manage, getField: read, updateField: manage, archiveField: manage, getRecordFields: read, updateRecordFields: manage, listTags: read, createTag: manage, updateTag: manage, archiveTag: manage, getRecordTags: read, setRecordTags: manage, fields: read }],
    [CrmSavedViewController, { list: read, create: manage, get: read, update: manage, archive: manage }],
    [CrmSegmentController, { list: read, create: manage, previewDefinition: read, preview: read, records: read, get: read, update: manage, archive: manage }],
  ] as const;
  for (const [controller, methods] of groups) {
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, controller), [AccessTokenGuard, PlatformPermissionGuard]);
    for (const [name, permissions] of Object.entries(methods)) {
      assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, (controller.prototype as unknown as Record<string, object>)[name]!), permissions, `${controller.name}.${name}`);
    }
  }
});
