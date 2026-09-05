import { SetMetadata } from "@nestjs/common";
import { PlatformPermissionKey, TenantPermissionKey } from "./permission.constants";

export const PLATFORM_PERMISSIONS_METADATA = "ucafe:platform-permissions";
export const TENANT_PERMISSIONS_METADATA = "ucafe:tenant-permissions";

export function RequirePlatformPermissions(...permissions: PlatformPermissionKey[]) {
  if (permissions.length === 0) throw new Error("At least one platform permission is required");
  return SetMetadata(PLATFORM_PERMISSIONS_METADATA, permissions);
}

export function RequireTenantPermissions(...permissions: TenantPermissionKey[]) {
  if (permissions.length === 0) throw new Error("At least one tenant permission is required");
  return SetMetadata(TENANT_PERMISSIONS_METADATA, permissions);
}
