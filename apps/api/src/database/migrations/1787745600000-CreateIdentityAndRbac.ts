import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateIdentityAndRbac1787745600000 implements MigrationInterface {
  name = "CreateIdentityAndRbac1787745600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "user_status" AS ENUM ('ACTIVE','BLOCKED','DELETED')`);
    await queryRunner.query(`CREATE TYPE "membership_status" AS ENUM ('INVITED','ACTIVE','SUSPENDED','REVOKED')`);
    await queryRunner.query(`CREATE TYPE "authorization_scope" AS ENUM ('PLATFORM','TENANT')`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "phone" varchar(16),
        "email" varchar(254),
        "password_hash" varchar(255),
        "status" user_status NOT NULL DEFAULT 'ACTIVE',
        "locale" varchar(16) NOT NULL DEFAULT 'fa-IR',
        "phone_verified_at" timestamptz,
        "email_verified_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "UQ_users_phone" UNIQUE ("phone"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "CK_users_identity" CHECK (phone IS NOT NULL OR email IS NOT NULL),
        CONSTRAINT "CK_users_phone_e164" CHECK (phone IS NULL OR phone ~ '^\\+[1-9][0-9]{7,14}$'),
        CONSTRAINT "CK_users_email_lowercase" CHECK (email IS NULL OR email = lower(email))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "coffee_shop_memberships" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "status" membership_status NOT NULL DEFAULT 'INVITED',
        "invited_by_user_id" uuid,
        "invited_at" timestamptz,
        "accepted_at" timestamptz,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_memberships_tenant_user" UNIQUE ("coffee_shop_id","user_id"),
        CONSTRAINT "FK_memberships_tenant" FOREIGN KEY ("coffee_shop_id") REFERENCES "coffee_shops"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_memberships_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_memberships_inviter" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_memberships_user_status" ON "coffee_shop_memberships" ("user_id","status")`);
    await queryRunner.query(`CREATE INDEX "IDX_memberships_tenant_status" ON "coffee_shop_memberships" ("coffee_shop_id","status")`);

    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid,
        "scope" authorization_scope NOT NULL,
        "key" varchar(80) NOT NULL,
        "name" varchar(120) NOT NULL,
        "is_system" boolean NOT NULL DEFAULT false,
        "is_protected" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_roles_tenant" FOREIGN KEY ("coffee_shop_id") REFERENCES "coffee_shops"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_roles_platform_global" CHECK (scope <> 'PLATFORM' OR coffee_shop_id IS NULL)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_roles_global_key" ON "roles" ("key") WHERE "coffee_shop_id" IS NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_roles_tenant_key" ON "roles" ("coffee_shop_id","key") WHERE "coffee_shop_id" IS NOT NULL`);

    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "scope" authorization_scope NOT NULL,
        "key" varchar(120) NOT NULL,
        "description" varchar(240) NOT NULL,
        CONSTRAINT "UQ_permissions_key" UNIQUE ("key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "membership_roles" (
        "membership_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        PRIMARY KEY ("membership_id","role_id"),
        CONSTRAINT "FK_membership_roles_membership" FOREIGN KEY ("membership_id") REFERENCES "coffee_shop_memberships"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_membership_roles_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "user_platform_roles" (
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        PRIMARY KEY ("user_id","role_id"),
        CONSTRAINT "FK_user_platform_roles_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_platform_roles_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "role_id" uuid NOT NULL,
        "permission_id" uuid NOT NULL,
        PRIMARY KEY ("role_id","permission_id"),
        CONSTRAINT "FK_role_permissions_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE FUNCTION enforce_membership_role_scope() RETURNS trigger AS $$
      DECLARE membership_tenant uuid; role_tenant uuid; role_scope authorization_scope;
      BEGIN
        SELECT coffee_shop_id INTO membership_tenant FROM coffee_shop_memberships WHERE id = NEW.membership_id;
        SELECT coffee_shop_id, scope INTO role_tenant, role_scope FROM roles WHERE id = NEW.role_id;
        IF role_scope <> 'TENANT' OR (role_tenant IS NOT NULL AND role_tenant <> membership_tenant) THEN
          RAISE EXCEPTION 'Role is not valid for this membership';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`CREATE TRIGGER "TR_membership_role_scope" BEFORE INSERT OR UPDATE ON "membership_roles" FOR EACH ROW EXECUTE FUNCTION enforce_membership_role_scope()`);

    await queryRunner.query(`
      CREATE FUNCTION enforce_platform_role_scope() RETURNS trigger AS $$
      DECLARE role_tenant uuid; role_scope authorization_scope;
      BEGIN
        SELECT coffee_shop_id, scope INTO role_tenant, role_scope FROM roles WHERE id = NEW.role_id;
        IF role_scope <> 'PLATFORM' OR role_tenant IS NOT NULL THEN
          RAISE EXCEPTION 'Role is not a global platform role';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`CREATE TRIGGER "TR_platform_role_scope" BEFORE INSERT OR UPDATE ON "user_platform_roles" FOR EACH ROW EXECUTE FUNCTION enforce_platform_role_scope()`);

    await queryRunner.query(`
      CREATE FUNCTION enforce_role_permission_scope() RETURNS trigger AS $$
      DECLARE role_scope authorization_scope; permission_scope authorization_scope;
      BEGIN
        SELECT scope INTO role_scope FROM roles WHERE id = NEW.role_id;
        SELECT scope INTO permission_scope FROM permissions WHERE id = NEW.permission_id;
        IF role_scope <> permission_scope THEN RAISE EXCEPTION 'Role and permission scopes must match'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`CREATE TRIGGER "TR_role_permission_scope" BEFORE INSERT OR UPDATE ON "role_permissions" FOR EACH ROW EXECUTE FUNCTION enforce_role_permission_scope()`);

    await queryRunner.query(`
      INSERT INTO "roles" ("scope","key","name","is_system","is_protected") VALUES
      ('PLATFORM','platform_owner','مالک پلتفرم',true,true),
      ('PLATFORM','platform_admin','مدیر پلتفرم',true,true),
      ('PLATFORM','support_operator','پشتیبان',true,true),
      ('TENANT','owner','مالک کافه',true,true),
      ('TENANT','content_editor','ویرایشگر محتوا',true,true)
    `);

    await queryRunner.query(`
      INSERT INTO "permissions" ("scope","key","description") VALUES
      ('PLATFORM','tenants.create','Create coffee-shop tenants'),
      ('PLATFORM','tenants.read','View coffee-shop tenants'),
      ('PLATFORM','tenants.update','Update coffee-shop tenants'),
      ('PLATFORM','tenants.lifecycle.manage','Manage tenant lifecycle'),
      ('PLATFORM','subscriptions.manage','Manage subscriptions and payments'),
      ('PLATFORM','audit.read','View platform audit records'),
      ('TENANT','site.manage','Manage website content and branding'),
      ('TENANT','menu.read','View menu administration data'),
      ('TENANT','menu.manage','Manage categories and menu items'),
      ('TENANT','reservations.read','View reservations'),
      ('TENANT','reservations.manage','Manage reservations'),
      ('TENANT','staff.manage','Manage coffee-shop staff'),
      ('TENANT','subscription.read','View the tenant subscription')
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id","permission_id")
      SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p
      WHERE r.key = 'platform_owner' AND r.scope = 'PLATFORM' AND p.scope = 'PLATFORM'
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id","permission_id")
      SELECT r.id, p.id FROM "roles" r JOIN "permissions" p ON p.key IN ('tenants.create','tenants.read','tenants.update','tenants.lifecycle.manage','subscriptions.manage','audit.read')
      WHERE r.key = 'platform_admin' AND r.scope = 'PLATFORM'
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id","permission_id")
      SELECT r.id, p.id FROM "roles" r JOIN "permissions" p ON p.key IN ('tenants.read','audit.read')
      WHERE r.key = 'support_operator' AND r.scope = 'PLATFORM'
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id","permission_id")
      SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p
      WHERE r.key = 'owner' AND r.scope = 'TENANT' AND p.scope = 'TENANT'
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id","permission_id")
      SELECT r.id, p.id FROM "roles" r JOIN "permissions" p ON p.key IN ('site.manage','menu.read','menu.manage')
      WHERE r.key = 'content_editor' AND r.scope = 'TENANT'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "user_platform_roles"`);
    await queryRunner.query(`DROP TABLE "membership_roles"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TABLE "coffee_shop_memberships"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP FUNCTION enforce_role_permission_scope`);
    await queryRunner.query(`DROP FUNCTION enforce_platform_role_scope`);
    await queryRunner.query(`DROP FUNCTION enforce_membership_role_scope`);
    await queryRunner.query(`DROP TYPE "authorization_scope"`);
    await queryRunner.query(`DROP TYPE "membership_status"`);
    await queryRunner.query(`DROP TYPE "user_status"`);
  }
}
