import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePlatformAuditTrail1787767200000 implements MigrationInterface {
  name = "CreatePlatformAuditTrail1787767200000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "platform_audit_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "action" varchar(80) NOT NULL,
        "target_type" varchar(40) NOT NULL,
        "target_id" varchar(160) NOT NULL,
        "summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_platform_audit_events_created_at" ON "platform_audit_events" ("created_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "idx_platform_audit_events_target" ON "platform_audit_events" ("target_type", "target_id", "created_at" DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "platform_audit_events"`);
  }
}
