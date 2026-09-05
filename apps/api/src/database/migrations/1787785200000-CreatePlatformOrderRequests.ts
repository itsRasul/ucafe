import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePlatformOrderRequests1787785200000 implements MigrationInterface {
  name = "CreatePlatformOrderRequests1787785200000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "platform_order_business_stage" AS ENUM ('LAUNCHING', 'OPERATING', 'MULTI_BRANCH')`);
    await queryRunner.query(`CREATE TYPE "platform_order_service" AS ENUM ('WEBSITE', 'ONLINE_MENU', 'RESERVATIONS', 'CONTENT_MANAGEMENT', 'CONSULTATION')`);
    await queryRunner.query(`CREATE TYPE "platform_order_status" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED')`);
    await queryRunner.query(`CREATE TABLE "platform_order_requests" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "contact_name" character varying(100) NOT NULL,
      "coffee_shop_name" character varying(160) NOT NULL,
      "phone_encrypted" text NOT NULL,
      "phone_hash" character(64) NOT NULL,
      "city" character varying(100) NOT NULL,
      "business_stage" "platform_order_business_stage" NOT NULL,
      "requested_services" "platform_order_service" array NOT NULL,
      "note" character varying(1000),
      "status" "platform_order_status" NOT NULL DEFAULT 'NEW',
      "source" character varying(40) NOT NULL DEFAULT 'platform_landing',
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_platform_order_requests" PRIMARY KEY ("id"),
      CONSTRAINT "CK_platform_order_requests_services" CHECK (cardinality("requested_services") BETWEEN 1 AND 5)
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_platform_order_requests_phone_hash_created_at" ON "platform_order_requests" ("phone_hash", "created_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_platform_order_requests_phone_hash_created_at"`);
    await queryRunner.query(`DROP TABLE "platform_order_requests"`);
    await queryRunner.query(`DROP TYPE "platform_order_status"`);
    await queryRunner.query(`DROP TYPE "platform_order_service"`);
    await queryRunner.query(`DROP TYPE "platform_order_business_stage"`);
  }
}
