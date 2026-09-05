import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTenantFoundation1787742000000 implements MigrationInterface {
  name = "CreateTenantFoundation1787742000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "coffee_shop_status" AS ENUM ('DRAFT','PREVIEW','ACTIVE','SUSPENDED','ARCHIVED')`);
    await queryRunner.query(`CREATE TYPE "domain_type" AS ENUM ('PLATFORM_SUBDOMAIN','PREVIEW','CUSTOM')`);
    await queryRunner.query(`CREATE TYPE "domain_status" AS ENUM ('PENDING','ACTIVE','FAILED','REVOKED')`);

    await queryRunner.query(`
      CREATE TABLE "coffee_shops" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(160) NOT NULL,
        "slug" varchar(63) NOT NULL,
        "status" coffee_shop_status NOT NULL DEFAULT 'DRAFT',
        "default_locale" varchar(16) NOT NULL DEFAULT 'fa-IR',
        "timezone" varchar(64) NOT NULL DEFAULT 'Asia/Tehran',
        "published_at" timestamptz,
        "suspended_at" timestamptz,
        "archived_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "CK_coffee_shops_slug" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT "UQ_coffee_shops_slug" UNIQUE ("slug")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "branches" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "slug" varchar(63) NOT NULL DEFAULT 'main',
        "is_primary" boolean NOT NULL DEFAULT false,
        "phone" varchar(32),
        "address" text,
        "latitude" numeric(9,6),
        "longitude" numeric(9,6),
        "timezone" varchar(64) NOT NULL DEFAULT 'Asia/Tehran',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "FK_branches_coffee_shop" FOREIGN KEY ("coffee_shop_id") REFERENCES "coffee_shops"("id") ON DELETE RESTRICT,
        CONSTRAINT "CK_branches_slug" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT "UQ_branches_tenant_slug" UNIQUE ("coffee_shop_id", "slug")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_branches_primary_per_tenant" ON "branches" ("coffee_shop_id") WHERE "is_primary" = true AND "deleted_at" IS NULL`);

    await queryRunner.query(`
      CREATE TABLE "domains" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL,
        "hostname" varchar(253) NOT NULL,
        "type" domain_type NOT NULL,
        "status" domain_status NOT NULL DEFAULT 'PENDING',
        "is_primary" boolean NOT NULL DEFAULT false,
        "verification_token_hash" varchar(128),
        "verified_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "FK_domains_coffee_shop" FOREIGN KEY ("coffee_shop_id") REFERENCES "coffee_shops"("id") ON DELETE RESTRICT,
        CONSTRAINT "CK_domains_hostname_lowercase" CHECK (hostname = lower(hostname)),
        CONSTRAINT "UQ_domains_hostname" UNIQUE ("hostname")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_domains_primary_per_tenant" ON "domains" ("coffee_shop_id") WHERE "is_primary" = true AND "deleted_at" IS NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_domains_tenant_status" ON "domains" ("coffee_shop_id", "status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "domains"`);
    await queryRunner.query(`DROP TABLE "branches"`);
    await queryRunner.query(`DROP TABLE "coffee_shops"`);
    await queryRunner.query(`DROP TYPE "domain_status"`);
    await queryRunner.query(`DROP TYPE "domain_type"`);
    await queryRunner.query(`DROP TYPE "coffee_shop_status"`);
  }
}
