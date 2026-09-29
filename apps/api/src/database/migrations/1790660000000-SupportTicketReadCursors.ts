import { MigrationInterface, QueryRunner } from "typeorm";

export class SupportTicketReadCursors1790660000000 implements MigrationInterface {
  name = "SupportTicketReadCursors1790660000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "support_tickets" ADD COLUMN "tenant_last_read_at" timestamptz, ADD COLUMN "platform_last_read_at" timestamptz`);
    await queryRunner.query(`
      UPDATE "support_tickets"
      SET "tenant_last_read_at" = CASE WHEN "last_message_sender_type" = 'TENANT_USER' THEN "last_message_at" END,
          "platform_last_read_at" = CASE WHEN "last_message_sender_type" = 'PLATFORM_USER' THEN "last_message_at" END
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "support_tickets" DROP COLUMN "platform_last_read_at", DROP COLUMN "tenant_last_read_at"`);
  }
}
