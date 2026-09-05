import { MigrationInterface, QueryRunner } from "typeorm";

export class ExpandPlatformAccessManagement1787788800000 implements MigrationInterface {
  name = "ExpandPlatformAccessManagement1787788800000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("scope", "key", "description") VALUES
        ('PLATFORM', 'users.read', 'View platform users and memberships'),
        ('PLATFORM', 'users.manage', 'Manage user status and role assignments'),
        ('PLATFORM', 'roles.read', 'View platform and tenant roles'),
        ('PLATFORM', 'roles.manage', 'Manage custom roles and role permissions'),
        ('PLATFORM', 'permissions.read', 'View the permission catalog')
      ON CONFLICT ("key") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT role.id, permission.id
      FROM "roles" role
      CROSS JOIN "permissions" permission
      WHERE role.key = 'platform_owner'
        AND role.scope = 'PLATFORM'
        AND permission.key IN ('users.read', 'users.manage', 'roles.read', 'roles.manage', 'permissions.read')
      ON CONFLICT DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "key" IN ('users.read', 'users.manage', 'roles.read', 'roles.manage', 'permissions.read')
    `);
  }
}
