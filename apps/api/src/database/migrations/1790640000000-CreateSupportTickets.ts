import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSupportTickets1790640000000 implements MigrationInterface {
  name = "CreateSupportTickets1790640000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "support_ticket_department" AS ENUM ('TECHNICAL','SALES')`);
    await queryRunner.query(`CREATE TYPE "support_ticket_status" AS ENUM ('WAITING_FOR_PLATFORM','WAITING_FOR_TENANT','CLOSED')`);
    await queryRunner.query(`CREATE TYPE "support_ticket_close_reason" AS ENUM ('MANUAL','INACTIVITY')`);
    await queryRunner.query(`CREATE TYPE "support_ticket_sender_type" AS ENUM ('TENANT_USER','PLATFORM_USER')`);
    await queryRunner.query(`CREATE SEQUENCE "support_ticket_reference_seq"`);
    await queryRunner.query(`
      CREATE TABLE "support_tickets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "reference_number" varchar(24) NOT NULL DEFAULT ('UC-' || nextval('support_ticket_reference_seq')::text),
        "coffee_shop_id" uuid NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "subject" varchar(160) NOT NULL,
        "department" support_ticket_department NOT NULL,
        "status" support_ticket_status NOT NULL DEFAULT 'WAITING_FOR_PLATFORM',
        "close_reason" support_ticket_close_reason,
        "closed_at" timestamptz,
        "closed_by_user_id" uuid,
        "last_message_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
        "last_message_sender_type" support_ticket_sender_type NOT NULL DEFAULT 'TENANT_USER',
        "last_platform_reply_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_support_tickets_reference" UNIQUE ("reference_number"),
        CONSTRAINT "UQ_support_tickets_tenant_id" UNIQUE ("coffee_shop_id","id"),
        CONSTRAINT "FK_support_tickets_tenant" FOREIGN KEY ("coffee_shop_id") REFERENCES "coffee_shops"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_support_tickets_creator_membership" FOREIGN KEY ("coffee_shop_id","created_by_user_id") REFERENCES "coffee_shop_memberships"("coffee_shop_id","user_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_support_tickets_closer" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CK_support_tickets_subject" CHECK (length(btrim("subject")) BETWEEN 1 AND 160),
        CONSTRAINT "CK_support_tickets_closure" CHECK (
          ("close_reason" IS NULL AND "closed_at" IS NULL AND "closed_by_user_id" IS NULL) OR
          ("close_reason" = 'MANUAL' AND "closed_at" IS NOT NULL AND "closed_by_user_id" IS NOT NULL) OR
          ("close_reason" = 'INACTIVITY' AND "closed_at" IS NOT NULL AND "closed_by_user_id" IS NULL)
        ),
        CONSTRAINT "CK_support_tickets_closed" CHECK ("status" <> 'CLOSED' OR "close_reason" IS NOT NULL)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_support_tickets_tenant_activity" ON "support_tickets" ("coffee_shop_id","status","last_message_at" DESC,"id" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_support_tickets_platform_activity" ON "support_tickets" ("status","department","last_message_at" DESC,"id" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_support_tickets_inactivity" ON "support_tickets" ("last_platform_reply_at") WHERE "status" = 'WAITING_FOR_TENANT'`);
    await queryRunner.query(`
      CREATE TABLE "support_ticket_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL,
        "ticket_id" uuid NOT NULL,
        "sender_user_id" uuid NOT NULL,
        "sender_type" support_ticket_sender_type NOT NULL,
        "body" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "FK_support_ticket_messages_ticket" FOREIGN KEY ("coffee_shop_id","ticket_id") REFERENCES "support_tickets"("coffee_shop_id","id") ON DELETE RESTRICT,
        CONSTRAINT "FK_support_ticket_messages_sender" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CK_support_ticket_messages_body" CHECK (length(btrim("body")) BETWEEN 1 AND 10000)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_support_ticket_messages_thread" ON "support_ticket_messages" ("coffee_shop_id","ticket_id","created_at","id")`);
    await queryRunner.query(`
      CREATE FUNCTION enforce_support_ticket_tenant_sender() RETURNS trigger AS $$
      DECLARE member_status membership_status; actor_status user_status; actor_deleted_at timestamptz;
      BEGIN
        IF NEW.sender_type <> 'TENANT_USER' THEN RETURN NEW; END IF;
        SELECT m.status, u.status, u.deleted_at INTO member_status, actor_status, actor_deleted_at
        FROM coffee_shop_memberships m JOIN users u ON u.id=m.user_id
        WHERE m.coffee_shop_id=NEW.coffee_shop_id AND m.user_id=NEW.sender_user_id
        FOR SHARE OF m, u;
        IF NOT FOUND OR member_status <> 'ACTIVE' OR actor_status <> 'ACTIVE' OR actor_deleted_at IS NOT NULL THEN
          RAISE EXCEPTION 'Support ticket tenant sender must be an active tenant member';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`CREATE TRIGGER "TR_support_ticket_tenant_sender" BEFORE INSERT ON "support_ticket_messages" FOR EACH ROW EXECUTE FUNCTION enforce_support_ticket_tenant_sender()`);
    await queryRunner.query(`
      INSERT INTO "permissions" ("scope","key","description") VALUES
        ('TENANT','support.tickets.use','Create and manage the tenant support conversation'),
        ('PLATFORM','support.tickets.view','List and inspect support tickets'),
        ('PLATFORM','support.tickets.reply','Reply to support tickets'),
        ('PLATFORM','support.tickets.manage','Close and reopen support tickets')
      ON CONFLICT ("key") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id","permission_id")
      SELECT r.id,p.id FROM "roles" r JOIN "permissions" p ON p.key='support.tickets.use'
      WHERE r.scope='TENANT' AND r.key='owner' ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id","permission_id")
      SELECT r.id,p.id FROM "roles" r JOIN "permissions" p ON p.key IN ('support.tickets.view','support.tickets.reply')
      WHERE r.scope='PLATFORM' AND r.key='support_operator' ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id","permission_id")
      SELECT r.id,p.id FROM "roles" r JOIN "permissions" p ON p.key IN ('support.tickets.view','support.tickets.reply','support.tickets.manage')
      WHERE r.scope='PLATFORM' AND r.key='platform_owner' ON CONFLICT DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "role_permissions" rp USING "permissions" p WHERE rp.permission_id=p.id AND p.key IN ('support.tickets.use','support.tickets.view','support.tickets.reply','support.tickets.manage')`);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "key" IN ('support.tickets.use','support.tickets.view','support.tickets.reply','support.tickets.manage')`);
    await queryRunner.query(`DROP TRIGGER "TR_support_ticket_tenant_sender" ON "support_ticket_messages"`);
    await queryRunner.query(`DROP FUNCTION "enforce_support_ticket_tenant_sender"`);
    await queryRunner.query(`DROP TABLE "support_ticket_messages"`);
    await queryRunner.query(`DROP TABLE "support_tickets"`);
    await queryRunner.query(`DROP SEQUENCE "support_ticket_reference_seq"`);
    await queryRunner.query(`DROP TYPE "support_ticket_sender_type"`);
    await queryRunner.query(`DROP TYPE "support_ticket_close_reason"`);
    await queryRunner.query(`DROP TYPE "support_ticket_status"`);
    await queryRunner.query(`DROP TYPE "support_ticket_department"`);
  }
}
