import { MigrationInterface, QueryRunner } from "typeorm";

export class SupportTicketAttachments1790650000000 implements MigrationInterface {
  name = "SupportTicketAttachments1790650000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "UQ_support_ticket_messages_tenant_id" UNIQUE ("coffee_shop_id","id")`);
    await queryRunner.query(`
      CREATE TABLE "support_ticket_attachments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL,
        "ticket_message_id" uuid NOT NULL,
        "storage_key" text NOT NULL,
        "original_filename" varchar(180) NOT NULL,
        "detected_mime_type" varchar(64) NOT NULL,
        "size_bytes" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_support_ticket_attachments_storage_key" UNIQUE ("storage_key"),
        CONSTRAINT "FK_support_ticket_attachments_message" FOREIGN KEY ("coffee_shop_id","ticket_message_id") REFERENCES "support_ticket_messages"("coffee_shop_id","id") ON DELETE RESTRICT,
        CONSTRAINT "CK_support_ticket_attachments_filename" CHECK (length(btrim("original_filename")) BETWEEN 1 AND 180),
        CONSTRAINT "CK_support_ticket_attachments_mime" CHECK ("detected_mime_type" IN ('image/jpeg','image/png','image/webp','application/pdf')),
        CONSTRAINT "CK_support_ticket_attachments_size" CHECK ("size_bytes" BETWEEN 1 AND 8388608)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_support_ticket_attachments_message" ON "support_ticket_attachments" ("coffee_shop_id","ticket_message_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "support_ticket_attachments"`);
    await queryRunner.query(`ALTER TABLE "support_ticket_messages" DROP CONSTRAINT "UQ_support_ticket_messages_tenant_id"`);
  }
}
