import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { normalizeIranianMobile } from "../auth/iran-phone.util";
import { PlatformAuditService } from "../audit/platform-audit.service";
import { AuthorizationScope, MembershipStatus, UserStatus } from "./entities";
import { CreateRoleDto, CreateUserDto, PlatformRolesQueryDto, PlatformUsersQueryDto, UpdateRoleDto } from "./dto/platform-access.dto";

type DbRow = Record<string, unknown>;

@Injectable()
export class PlatformAccessService {
  constructor(private readonly dataSource: DataSource, private readonly audit: PlatformAuditService) {}

  async listUsers(query: PlatformUsersQueryDto) {
    const where = [`u.deleted_at IS NULL`];
    const values: unknown[] = [];
    if (query.status) { values.push(query.status); where.push(`u.status = $${values.length}`); }
    if (query.q?.trim()) {
      const q = query.q.trim();
      let phone: string | null = null;
      if (/^[+۰-۹٠-٩0-9\s()-]+$/.test(q)) {
        try { phone = normalizeIranianMobile(q); } catch { throw new BadRequestException("Enter a complete valid Iranian mobile number"); }
      }
      values.push(phone ?? `%${q.toLowerCase()}%`);
      where.push(phone ? `u.phone = $${values.length}` : `(lower(COALESCE(u.email, '')) LIKE $${values.length} OR u.id::text = $${values.length})`);
    }
    const countRows = await this.dataSource.query<Array<{ total: string }>>(`SELECT count(*)::text AS total FROM users u WHERE ${where.join(" AND ")}`, values);
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await this.dataSource.query<Array<DbRow>>(`
      SELECT u.id, u.phone, u.email, u.status, u.locale, u.created_at AS "createdAt",
        count(DISTINCT membership.id)::int AS "membershipCount",
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', platform_role.id, 'key', platform_role.key, 'name', platform_role.name)) FILTER (WHERE platform_role.id IS NOT NULL), '[]'::jsonb) AS "platformRoles"
      FROM users u
      LEFT JOIN coffee_shop_memberships membership ON membership.user_id = u.id
      LEFT JOIN user_platform_roles platform_assignment ON platform_assignment.user_id = u.id
      LEFT JOIN roles platform_role ON platform_role.id = platform_assignment.role_id
      WHERE ${where.join(" AND ")}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);
    return { items: rows, total: Number(countRows[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async getUser(userId: string) {
    const users = await this.dataSource.query<Array<DbRow>>(`SELECT id, phone, email, status, locale, phone_verified_at AS "phoneVerifiedAt", created_at AS "createdAt" FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
    const user = users[0];
    if (!user) throw new NotFoundException("User not found");
    const platformRoles = await this.dataSource.query<Array<DbRow>>(`SELECT r.id, r.key, r.name FROM user_platform_roles a JOIN roles r ON r.id = a.role_id WHERE a.user_id = $1 ORDER BY r.name`, [userId]);
    const memberships = await this.dataSource.query<Array<DbRow>>(`
      SELECT m.id, m.status, c.id AS "coffeeShopId", c.name AS "coffeeShopName",
        COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name)) FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS roles
      FROM coffee_shop_memberships m JOIN coffee_shops c ON c.id = m.coffee_shop_id
      LEFT JOIN membership_roles a ON a.membership_id = m.id LEFT JOIN roles r ON r.id = a.role_id
      WHERE m.user_id = $1 GROUP BY m.id, c.id ORDER BY c.name
    `, [userId]);
    const effectivePermissions = await this.dataSource.query<Array<{ key: string; scope: AuthorizationScope }>>(`
      SELECT DISTINCT p.key, p.scope FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN roles r ON r.id = rp.role_id
      WHERE r.id IN (SELECT role_id FROM user_platform_roles WHERE user_id = $1)
         OR r.id IN (SELECT mr.role_id FROM membership_roles mr JOIN coffee_shop_memberships m ON m.id = mr.membership_id WHERE m.user_id = $1 AND m.status = 'ACTIVE')
      ORDER BY p.scope, p.key
    `, [userId]);
    return { ...user, platformRoles, memberships, effectivePermissions };
  }

  async createUser(input: CreateUserDto, actorUserId: string) {
    const phone = normalizeIranianMobile(input.phone);
    const user = await this.dataSource.transaction(async (manager) => {
      const roles = await manager.query<Array<{ id: string; key: string; name: string; scope: AuthorizationScope; coffeeShopId: string | null }>>(
        `SELECT id, key, name, scope, coffee_shop_id AS "coffeeShopId" FROM roles WHERE id = $1`, [input.roleId],
      );
      const role = roles[0];
      if (!role) throw new NotFoundException("Role not found");
      const coffeeShopId: string | null = role.scope === AuthorizationScope.Tenant ? role.coffeeShopId ?? input.coffeeShopId ?? null : null;
      if (role.scope === AuthorizationScope.Tenant && !coffeeShopId) throw new BadRequestException("A coffee shop is required for a tenant role");
      if (role.coffeeShopId && input.coffeeShopId && role.coffeeShopId !== input.coffeeShopId) throw new BadRequestException("Role does not belong to this coffee shop");
      if (coffeeShopId && !(await manager.query(`SELECT id FROM coffee_shops WHERE id = $1 AND deleted_at IS NULL`, [coffeeShopId]))[0]) throw new NotFoundException("Coffee shop not found");

      try {
        const rows = await manager.query<Array<{ id: string; phone: string; status: UserStatus; createdAt: Date }>>(
          `INSERT INTO users (phone, status) VALUES ($1, 'ACTIVE') RETURNING id, phone, status, created_at AS "createdAt"`, [phone],
        );
        const created = rows[0];
        if (!created) throw new Error("User insert returned no row");
        if (role.scope === AuthorizationScope.Platform) {
          await manager.query(`INSERT INTO user_platform_roles (user_id, role_id) VALUES ($1, $2)`, [created.id, role.id]);
        } else {
          const memberships = await manager.query<Array<{ id: string }>>(
            `INSERT INTO coffee_shop_memberships (coffee_shop_id, user_id, status, invited_by_user_id, invited_at) VALUES ($1, $2, $3, $4, now()) RETURNING id`,
            [coffeeShopId, created.id, MembershipStatus.Invited, actorUserId],
          );
          await manager.query(`INSERT INTO membership_roles (membership_id, role_id) VALUES ($1, $2)`, [memberships[0]!.id, role.id]);
        }
        return { ...created, role, coffeeShopId };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new ConflictException("A user with this phone already exists");
        throw error;
      }
    });
    await this.audit.record({ actorUserId, action: "user.created", targetType: "user", targetId: user.id, summary: { roleId: user.role.id, roleKey: user.role.key, scope: user.role.scope, coffeeShopId: user.coffeeShopId } });
    return { id: user.id, phone: user.phone, status: user.status, createdAt: user.createdAt };
  }

  async updateUserStatus(userId: string, status: UserStatus.Active | UserStatus.Blocked, actorUserId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string; status: UserStatus; isOwner: boolean }>>(`
        SELECT u.id, u.status, EXISTS(SELECT 1 FROM user_platform_roles a JOIN roles r ON r.id = a.role_id WHERE a.user_id = u.id AND r.key = 'platform_owner' AND r.scope = 'PLATFORM') AS "isOwner"
        FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL FOR UPDATE
      `, [userId]);
      const user = rows[0];
      if (!user) throw new NotFoundException("User not found");
      if (status === UserStatus.Blocked && user.isOwner) {
        if (userId === actorUserId) throw new ConflictException("You cannot block your own platform owner account");
        const owners = await manager.query<Array<{ total: string }>>(`SELECT count(DISTINCT u.id)::text AS total FROM users u JOIN user_platform_roles a ON a.user_id = u.id JOIN roles r ON r.id = a.role_id WHERE r.key = 'platform_owner' AND r.scope = 'PLATFORM' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL`);
        if (Number(owners[0]?.total ?? 0) <= 1) throw new ConflictException("The last active platform owner cannot be blocked");
      }
      await manager.query(`UPDATE users SET status = $2, updated_at = now() WHERE id = $1`, [userId, status]);
      if (status === UserStatus.Blocked) await manager.query(`UPDATE auth_sessions SET revoked_at = now(), updated_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
      return { previousStatus: user.status, status };
    });
    await this.audit.record({ actorUserId, action: "user.status_changed", targetType: "user", targetId: userId, summary: result });
    return result;
  }

  async listRoles(query: PlatformRolesQueryDto) {
    const values: unknown[] = [];
    const where: string[] = [];
    if (query.scope) { values.push(query.scope); where.push(`r.scope = $${values.length}`); }
    if (query.coffeeShopId) { values.push(query.coffeeShopId); where.push(`r.coffee_shop_id = $${values.length}`); }
    return this.dataSource.query<Array<DbRow>>(`
      SELECT r.id, r.coffee_shop_id AS "coffeeShopId", c.name AS "coffeeShopName", r.scope, r.key, r.name, r.is_system AS "isSystem", r.is_protected AS "isProtected",
        (SELECT count(*)::int FROM user_platform_roles a WHERE a.role_id = r.id) + (SELECT count(*)::int FROM membership_roles a WHERE a.role_id = r.id) AS "assignmentCount",
        COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'key', p.key, 'description', p.description)) FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb) AS permissions
      FROM roles r LEFT JOIN coffee_shops c ON c.id = r.coffee_shop_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY r.id, c.id ORDER BY r.scope, r.is_system DESC, r.name
    `, values);
  }

  async listPermissions() {
    return this.dataSource.query<Array<DbRow>>(`
      SELECT p.id, p.scope, p.key, p.description,
        count(DISTINCT rp.role_id)::int AS "roleCount",
        (SELECT count(DISTINCT user_id)::int FROM user_platform_roles upr JOIN role_permissions x ON x.role_id = upr.role_id WHERE x.permission_id = p.id)
        + (SELECT count(DISTINCT m.user_id)::int FROM membership_roles mr JOIN coffee_shop_memberships m ON m.id = mr.membership_id JOIN role_permissions x ON x.role_id = mr.role_id WHERE x.permission_id = p.id AND m.status = 'ACTIVE') AS "userCount"
      FROM permissions p LEFT JOIN role_permissions rp ON rp.permission_id = p.id GROUP BY p.id ORDER BY p.scope, p.key
    `);
  }

  async createRole(input: CreateRoleDto, actorUserId: string) {
    const coffeeShopId = input.scope === AuthorizationScope.Platform ? null : input.coffeeShopId;
    if (input.scope === AuthorizationScope.Tenant && !coffeeShopId) throw new BadRequestException("A custom tenant role must belong to a coffee shop");
    const role = await this.dataSource.transaction(async (manager) => {
      if (coffeeShopId && !(await manager.query(`SELECT id FROM coffee_shops WHERE id = $1 AND deleted_at IS NULL`, [coffeeShopId]))[0]) throw new NotFoundException("Coffee shop not found");
      await this.validatePermissions(manager, input.permissionIds, input.scope);
      try {
        const rows = await manager.query<Array<DbRow>>(`INSERT INTO roles (coffee_shop_id, scope, key, name, is_system, is_protected) VALUES ($1,$2,$3,$4,false,false) RETURNING id, coffee_shop_id AS "coffeeShopId", scope, key, name`, [coffeeShopId, input.scope, input.key, input.name.trim()]);
        const created = rows[0];
        if (!created) throw new Error("Role insert returned no row");
        for (const permissionId of input.permissionIds) await manager.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)`, [created.id, permissionId]);
        return created;
      } catch (error) { if ((error as { code?: string }).code === "23505") throw new ConflictException("Role key already exists in this scope"); throw error; }
    });
    if (!role) throw new Error("Role creation failed");
    await this.audit.record({ actorUserId, action: "role.created", targetType: "role", targetId: String(role.id), summary: { key: input.key, scope: input.scope } });
    return role;
  }

  async updateRole(roleId: string, input: UpdateRoleDto, actorUserId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const roles = await manager.query<Array<{ id: string; scope: AuthorizationScope; name: string; isSystem: boolean; isProtected: boolean }>>(`SELECT id, scope, name, is_system AS "isSystem", is_protected AS "isProtected" FROM roles WHERE id = $1 FOR UPDATE`, [roleId]);
      const role = roles[0]; if (!role) throw new NotFoundException("Role not found");
      await this.validatePermissions(manager, input.permissionIds, role.scope);
      const name = role.isSystem || role.isProtected ? role.name : input.name.trim();
      await manager.query(`UPDATE roles SET name = $2, updated_at = now() WHERE id = $1`, [roleId, name]);
      await manager.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
      for (const permissionId of input.permissionIds) await manager.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)`, [roleId, permissionId]);
      if (role.scope === AuthorizationScope.Platform) {
        const managers = await manager.query<Array<{ total: string }>>(`
          SELECT count(*)::text AS total FROM (
            SELECT u.id FROM users u
            JOIN user_platform_roles upr ON upr.user_id = u.id
            JOIN role_permissions rp ON rp.role_id = upr.role_id
            JOIN permissions p ON p.id = rp.permission_id
            WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL AND p.key IN ('roles.manage', 'permissions.read')
            GROUP BY u.id HAVING count(DISTINCT p.key) = 2
          ) manager
        `);
        if (Number(managers[0]?.total ?? 0) < 1) throw new ConflictException("At least one active platform user must retain role management access");
      }
      return { previousName: role.name, name, permissionCount: input.permissionIds.length };
    });
    await this.audit.record({ actorUserId, action: "role.updated", targetType: "role", targetId: roleId, summary: result }); return result;
  }

  async deleteRole(roleId: string, actorUserId: string) {
    const role = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string; key: string; isSystem: boolean; isProtected: boolean }>>(`SELECT id, key, is_system AS "isSystem", is_protected AS "isProtected" FROM roles WHERE id = $1 FOR UPDATE`, [roleId]);
      const current = rows[0]; if (!current) throw new NotFoundException("Role not found");
      if (current.isSystem || current.isProtected) throw new ConflictException("System and protected roles cannot be deleted");
      const assignments = await manager.query<Array<{ total: string }>>(`SELECT ((SELECT count(*) FROM user_platform_roles WHERE role_id=$1)+(SELECT count(*) FROM membership_roles WHERE role_id=$1))::text AS total`, [roleId]);
      if (Number(assignments[0]?.total ?? 0) > 0) throw new ConflictException("Assigned roles cannot be deleted");
      await manager.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]); await manager.query(`DELETE FROM roles WHERE id = $1`, [roleId]); return current;
    });
    await this.audit.record({ actorUserId, action: "role.deleted", targetType: "role", targetId: roleId, summary: { key: role.key } });
  }

  async assignPlatformRole(userId: string, roleId: string, actorUserId: string) { return this.changePlatformRole(userId, roleId, actorUserId, true); }
  async removePlatformRole(userId: string, roleId: string, actorUserId: string) { return this.changePlatformRole(userId, roleId, actorUserId, false); }
  private async changePlatformRole(userId: string, roleId: string, actorUserId: string, assign: boolean) {
    const role = await this.dataSource.transaction(async (manager) => {
      const roles = await manager.query<Array<{ id: string; key: string; scope: AuthorizationScope; coffeeShopId: string | null }>>(`SELECT id,key,scope,coffee_shop_id AS "coffeeShopId" FROM roles WHERE id=$1`, [roleId]); const role = roles[0];
      if (!role || role.scope !== AuthorizationScope.Platform || role.coffeeShopId) throw new BadRequestException("Role is not a global platform role");
      if (!(await manager.query(`SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL`, [userId]))[0]) throw new NotFoundException("User not found");
      if (!assign && role.key === "platform_owner") {
        if (userId === actorUserId) throw new ConflictException("You cannot remove your own platform owner role");
        const count = await manager.query<Array<{ total: string }>>(`SELECT count(*)::text AS total FROM user_platform_roles a JOIN roles r ON r.id=a.role_id JOIN users u ON u.id=a.user_id WHERE r.key='platform_owner' AND u.status='ACTIVE' AND u.deleted_at IS NULL`);
        if (Number(count[0]?.total ?? 0) <= 1) throw new ConflictException("The last platform owner role cannot be removed");
      }
      if (assign) await manager.query(`INSERT INTO user_platform_roles (user_id,role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [userId, roleId]); else await manager.query(`DELETE FROM user_platform_roles WHERE user_id=$1 AND role_id=$2`, [userId, roleId]); return role;
    });
    await this.audit.record({ actorUserId, action: assign ? "user.platform_role_assigned" : "user.platform_role_removed", targetType: "user", targetId: userId, summary: { roleId, roleKey: role.key } });
  }

  async assignMembershipRole(membershipId: string, roleId: string, actorUserId: string) { return this.changeMembershipRole(membershipId, roleId, actorUserId, true); }
  async removeMembershipRole(membershipId: string, roleId: string, actorUserId: string) { return this.changeMembershipRole(membershipId, roleId, actorUserId, false); }
  private async changeMembershipRole(membershipId: string, roleId: string, actorUserId: string, assign: boolean) {
    const target = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ membershipId: string; userId: string; coffeeShopId: string; roleKey: string }>>(`SELECT m.id AS "membershipId",m.user_id AS "userId",m.coffee_shop_id AS "coffeeShopId",r.key AS "roleKey" FROM coffee_shop_memberships m JOIN roles r ON r.id=$2 WHERE m.id=$1 AND r.scope='TENANT' AND (r.coffee_shop_id IS NULL OR r.coffee_shop_id=m.coffee_shop_id)`, [membershipId, roleId]);
      const row = rows[0]; if (!row) throw new BadRequestException("Role is not valid for this membership");
      if (assign) await manager.query(`INSERT INTO membership_roles (membership_id,role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [membershipId, roleId]); else await manager.query(`DELETE FROM membership_roles WHERE membership_id=$1 AND role_id=$2`, [membershipId, roleId]); return row;
    });
    await this.audit.record({ actorUserId, action: assign ? "user.tenant_role_assigned" : "user.tenant_role_removed", targetType: "user", targetId: target.userId, summary: { membershipId, roleId, coffeeShopId: target.coffeeShopId, roleKey: target.roleKey } });
  }

  private async validatePermissions(manager: { query<T = unknown>(query: string, parameters?: unknown[]): Promise<T> }, permissionIds: string[], scope: AuthorizationScope) {
    if (!permissionIds.length) return;
    const rows = await manager.query<Array<{ id: string }>>(`SELECT id FROM permissions WHERE id = ANY($1::uuid[]) AND scope=$2`, [permissionIds, scope]);
    if (rows.length !== permissionIds.length) throw new BadRequestException("All role permissions must exist in the same scope");
  }
}
