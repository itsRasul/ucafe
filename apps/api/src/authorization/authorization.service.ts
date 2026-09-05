import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CoffeeShopMembership, MembershipStatus, UserPlatformRole } from "../identity/entities";
import { PlatformPermissionKey, TenantPermissionKey } from "./permission.constants";

interface PermissionRow {
  permission_key: string;
}

interface TenantPermissionRow extends PermissionRow {
  membership_id: string;
}

export interface TenantAccess {
  membershipId: string;
  permissions: TenantPermissionKey[];
}
export interface PlatformAccess { permissions: PlatformPermissionKey[] }

@Injectable()
export class AuthorizationService {
  constructor(
    @InjectRepository(CoffeeShopMembership)
    private readonly memberships: Repository<CoffeeShopMembership>,
    @InjectRepository(UserPlatformRole)
    private readonly platformRoles: Repository<UserPlatformRole>,
  ) {}

  async hasPlatformPermissions(userId: string, required: PlatformPermissionKey[]): Promise<boolean> {
    const permissions = [...new Set(required)];
    if (permissions.length === 0) return false;

    const rows = await this.platformRoles
      .createQueryBuilder("assignment")
      .innerJoin("users", "app_user", "app_user.id = assignment.user_id AND app_user.status = 'ACTIVE' AND app_user.deleted_at IS NULL")
      .innerJoin("roles", "role", "role.id = assignment.role_id AND role.scope = 'PLATFORM' AND role.coffee_shop_id IS NULL")
      .innerJoin("role_permissions", "role_permission", "role_permission.role_id = role.id")
      .innerJoin("permissions", "permission", "permission.id = role_permission.permission_id AND permission.scope = 'PLATFORM'")
      .where("assignment.user_id = :userId", { userId })
      .andWhere("permission.key IN (:...permissions)", { permissions })
      .select("permission.key", "permission_key")
      .distinct(true)
      .getRawMany<PermissionRow>();

    return new Set(rows.map((row) => row.permission_key)).size === permissions.length;
  }

  async authorizeTenant(
    userId: string,
    coffeeShopId: string,
    required: TenantPermissionKey[],
  ): Promise<{ permitted: boolean; membershipId?: string }> {
    const permissions = [...new Set(required)];
    if (permissions.length === 0) return { permitted: false };

    const rows = await this.memberships
      .createQueryBuilder("membership")
      .innerJoin("users", "app_user", "app_user.id = membership.user_id AND app_user.status = 'ACTIVE' AND app_user.deleted_at IS NULL")
      .innerJoin("membership_roles", "assignment", "assignment.membership_id = membership.id")
      .innerJoin("roles", "role", "role.id = assignment.role_id AND role.scope = 'TENANT'")
      .innerJoin("role_permissions", "role_permission", "role_permission.role_id = role.id")
      .innerJoin("permissions", "permission", "permission.id = role_permission.permission_id AND permission.scope = 'TENANT'")
      .where("membership.user_id = :userId", { userId })
      .andWhere("membership.coffee_shop_id = :coffeeShopId", { coffeeShopId })
      .andWhere("membership.status = :membershipStatus", { membershipStatus: MembershipStatus.Active })
      .andWhere("(role.coffee_shop_id IS NULL OR role.coffee_shop_id = membership.coffee_shop_id)")
      .andWhere("permission.key IN (:...permissions)", { permissions })
      .select("membership.id", "membership_id")
      .addSelect("permission.key", "permission_key")
      .distinct(true)
      .getRawMany<TenantPermissionRow>();

    const granted = new Set(rows.map((row) => row.permission_key));
    const membershipId = rows[0]?.membership_id;
    return { permitted: Boolean(membershipId) && granted.size === permissions.length, membershipId };
  }

  async getPlatformAccess(userId: string): Promise<PlatformAccess | null> {
    const rows = await this.platformRoles.createQueryBuilder("assignment")
      .innerJoin("users", "app_user", "app_user.id = assignment.user_id AND app_user.status = 'ACTIVE' AND app_user.deleted_at IS NULL")
      .innerJoin("roles", "role", "role.id = assignment.role_id AND role.scope = 'PLATFORM' AND role.coffee_shop_id IS NULL")
      .innerJoin("role_permissions", "role_permission", "role_permission.role_id = role.id")
      .innerJoin("permissions", "permission", "permission.id = role_permission.permission_id AND permission.scope = 'PLATFORM'")
      .where("assignment.user_id = :userId", { userId }).select("permission.key", "permission_key").distinct(true).getRawMany<PermissionRow>();
    const permissions = [...new Set(rows.map((row) => row.permission_key as PlatformPermissionKey))].sort();
    return permissions.length ? { permissions } : null;
  }

  async getTenantAccess(userId: string, coffeeShopId: string): Promise<TenantAccess | null> {
    const rows = await this.memberships
      .createQueryBuilder("membership")
      .innerJoin("users", "app_user", "app_user.id = membership.user_id AND app_user.status = 'ACTIVE' AND app_user.deleted_at IS NULL")
      .innerJoin("membership_roles", "assignment", "assignment.membership_id = membership.id")
      .innerJoin("roles", "role", "role.id = assignment.role_id AND role.scope = 'TENANT'")
      .innerJoin("role_permissions", "role_permission", "role_permission.role_id = role.id")
      .innerJoin("permissions", "permission", "permission.id = role_permission.permission_id AND permission.scope = 'TENANT'")
      .where("membership.user_id = :userId", { userId })
      .andWhere("membership.coffee_shop_id = :coffeeShopId", { coffeeShopId })
      .andWhere("membership.status = :membershipStatus", { membershipStatus: MembershipStatus.Active })
      .andWhere("(role.coffee_shop_id IS NULL OR role.coffee_shop_id = membership.coffee_shop_id)")
      .select("membership.id", "membership_id")
      .addSelect("permission.key", "permission_key")
      .distinct(true)
      .getRawMany<TenantPermissionRow>();

    const membershipId = rows[0]?.membership_id;
    if (!membershipId) return null;
    return {
      membershipId,
      permissions: [...new Set(rows.map((row) => row.permission_key as TenantPermissionKey))].sort(),
    };
  }
}
