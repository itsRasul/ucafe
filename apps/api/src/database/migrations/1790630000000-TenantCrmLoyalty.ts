import { MigrationInterface, QueryRunner } from "typeorm";

export class TenantCrmLoyalty1790630000000 implements MigrationInterface {
  name = "TenantCrmLoyalty1790630000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE orders ADD CONSTRAINT UQ_orders_tenant_id UNIQUE(coffee_shop_id,id)`);
    await queryRunner.query(`
      CREATE TABLE domain_event_outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_key varchar(160) NOT NULL UNIQUE,
        event_type varchar(80) NOT NULL,
        coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
        aggregate_type varchar(40) NOT NULL,
        aggregate_id uuid NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
        status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','PROCESSED','FAILED')),
        attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        claimed_at timestamptz,
        processed_at timestamptz,
        error_code varchar(50),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_domain_event_outbox_dispatch ON domain_event_outbox(status,next_attempt_at,created_at,id) WHERE status IN ('PENDING','PROCESSING')`);

    await queryRunner.query(`
      CREATE TABLE tenant_crm_loyalty_programs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
        enabled boolean NOT NULL,
        spend_per_point_toman bigint NOT NULL CHECK (spend_per_point_toman BETWEEN 1 AND 1000000000),
        created_by_user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT UQ_tenant_crm_loyalty_program_tenant_id UNIQUE(coffee_shop_id,id),
        CONSTRAINT FK_tenant_crm_loyalty_program_actor FOREIGN KEY(coffee_shop_id,created_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_loyalty_program_effective ON tenant_crm_loyalty_programs(coffee_shop_id,created_at DESC,id DESC)`);

    await queryRunner.query(`
      CREATE TABLE tenant_crm_loyalty_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        client_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT UQ_tenant_crm_loyalty_account_tenant_id UNIQUE(coffee_shop_id,id),
        CONSTRAINT UQ_tenant_crm_loyalty_account_client UNIQUE(coffee_shop_id,client_id),
        CONSTRAINT UQ_tenant_crm_loyalty_account_client_id UNIQUE(coffee_shop_id,id,client_id),
        CONSTRAINT FK_tenant_crm_loyalty_account_client FOREIGN KEY(coffee_shop_id,client_id)
          REFERENCES clients(coffee_shop_id,id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE tenant_crm_loyalty_rewards (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
        name varchar(120) NOT NULL CHECK (name=btrim(name) AND char_length(name) BETWEEN 1 AND 120),
        description varchar(500),
        points_cost integer NOT NULL CHECK (points_cost BETWEEN 1 AND 1000000000),
        is_active boolean NOT NULL DEFAULT true,
        created_by_user_id uuid NOT NULL,
        updated_by_user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT UQ_tenant_crm_loyalty_reward_tenant_id UNIQUE(coffee_shop_id,id),
        CONSTRAINT FK_tenant_crm_loyalty_reward_creator FOREIGN KEY(coffee_shop_id,created_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_loyalty_reward_editor FOREIGN KEY(coffee_shop_id,updated_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_loyalty_rewards ON tenant_crm_loyalty_rewards(coffee_shop_id,is_active,name,id)`);

    await queryRunner.query(`
      CREATE TABLE tenant_crm_loyalty_redemptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        client_id uuid NOT NULL,
        account_id uuid NOT NULL,
        reward_id uuid NOT NULL,
        reward_name_snapshot varchar(120) NOT NULL,
        points_spent integer NOT NULL CHECK (points_spent BETWEEN 1 AND 1000000000),
        idempotency_key varchar(120) NOT NULL,
        redeemed_by_user_id uuid NOT NULL,
        redeemed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT UQ_tenant_crm_loyalty_redemption_tenant_id UNIQUE(coffee_shop_id,id),
        CONSTRAINT UQ_tenant_crm_loyalty_redemption_idempotency UNIQUE(coffee_shop_id,idempotency_key),
        CONSTRAINT FK_tenant_crm_loyalty_redemption_client FOREIGN KEY(coffee_shop_id,client_id)
          REFERENCES clients(coffee_shop_id,id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_loyalty_redemption_account FOREIGN KEY(coffee_shop_id,account_id,client_id)
          REFERENCES tenant_crm_loyalty_accounts(coffee_shop_id,id,client_id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_loyalty_redemption_reward FOREIGN KEY(coffee_shop_id,reward_id)
          REFERENCES tenant_crm_loyalty_rewards(coffee_shop_id,id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_loyalty_redemption_actor FOREIGN KEY(coffee_shop_id,redeemed_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_loyalty_redemptions_client ON tenant_crm_loyalty_redemptions(coffee_shop_id,client_id,redeemed_at DESC,id DESC)`);

    await queryRunner.query(`
      CREATE TABLE tenant_crm_loyalty_ledger (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        client_id uuid NOT NULL,
        account_id uuid NOT NULL,
        entry_type varchar(20) NOT NULL CHECK (entry_type IN ('EARN','MANUAL_CREDIT','MANUAL_DEBIT','REDEMPTION')),
        points bigint NOT NULL CHECK (points<>0),
        reason varchar(500),
        order_id uuid,
        redemption_id uuid,
        qualifying_amount_toman bigint,
        spend_per_point_toman bigint,
        idempotency_key varchar(120) NOT NULL,
        created_by_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT UQ_tenant_crm_loyalty_ledger_tenant_id UNIQUE(coffee_shop_id,id),
        CONSTRAINT UQ_tenant_crm_loyalty_ledger_idempotency UNIQUE(coffee_shop_id,idempotency_key),
        CONSTRAINT CK_tenant_crm_loyalty_ledger_entry CHECK (
          (entry_type='EARN' AND points>0 AND order_id IS NOT NULL AND redemption_id IS NULL AND reason IS NULL
            AND qualifying_amount_toman IS NOT NULL AND qualifying_amount_toman>=0 AND spend_per_point_toman IS NOT NULL AND spend_per_point_toman>0 AND created_by_user_id IS NULL)
          OR (entry_type='MANUAL_CREDIT' AND points>0 AND reason IS NOT NULL AND order_id IS NULL AND redemption_id IS NULL
            AND qualifying_amount_toman IS NULL AND spend_per_point_toman IS NULL AND created_by_user_id IS NOT NULL)
          OR (entry_type='MANUAL_DEBIT' AND points<0 AND reason IS NOT NULL AND order_id IS NULL AND redemption_id IS NULL
            AND qualifying_amount_toman IS NULL AND spend_per_point_toman IS NULL AND created_by_user_id IS NOT NULL)
          OR (entry_type='REDEMPTION' AND points<0 AND reason IS NULL AND order_id IS NULL AND redemption_id IS NOT NULL
            AND qualifying_amount_toman IS NULL AND spend_per_point_toman IS NULL AND created_by_user_id IS NOT NULL)
        ),
        CONSTRAINT FK_tenant_crm_loyalty_ledger_client FOREIGN KEY(coffee_shop_id,client_id)
          REFERENCES clients(coffee_shop_id,id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_loyalty_ledger_account FOREIGN KEY(coffee_shop_id,account_id,client_id)
          REFERENCES tenant_crm_loyalty_accounts(coffee_shop_id,id,client_id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_loyalty_ledger_order FOREIGN KEY(coffee_shop_id,order_id)
          REFERENCES orders(coffee_shop_id,id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_loyalty_ledger_redemption FOREIGN KEY(coffee_shop_id,redemption_id)
          REFERENCES tenant_crm_loyalty_redemptions(coffee_shop_id,id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_loyalty_ledger_actor FOREIGN KEY(coffee_shop_id,created_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_tenant_crm_loyalty_ledger_order_earn ON tenant_crm_loyalty_ledger(coffee_shop_id,order_id) WHERE entry_type='EARN'`);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_loyalty_ledger_client ON tenant_crm_loyalty_ledger(coffee_shop_id,client_id,created_at DESC,id DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant_crm_loyalty_ledger`);
    await queryRunner.query(`DROP TABLE tenant_crm_loyalty_redemptions`);
    await queryRunner.query(`DROP TABLE tenant_crm_loyalty_rewards`);
    await queryRunner.query(`DROP TABLE tenant_crm_loyalty_accounts`);
    await queryRunner.query(`DROP TABLE tenant_crm_loyalty_programs`);
    await queryRunner.query(`DROP TABLE domain_event_outbox`);
    await queryRunner.query(`ALTER TABLE orders DROP CONSTRAINT UQ_orders_tenant_id`);
  }
}
