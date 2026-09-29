import { MigrationInterface, QueryRunner } from "typeorm";

export class TenantCrmOffers1790650000000 implements MigrationInterface {
  name = "TenantCrmOffers1790650000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant_crm_offers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
        name varchar(120) NOT NULL CHECK (name=btrim(name) AND char_length(name) BETWEEN 1 AND 120),
        description varchar(500),
        promotion_id uuid NOT NULL,
        segment_id uuid NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ENDED')),
        created_by_user_id uuid NOT NULL,
        activated_at timestamptz,
        ended_at timestamptz,
        segment_name_snapshot varchar(120),
        segment_criteria_snapshot jsonb,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT UQ_tenant_crm_offers_tenant_id UNIQUE (coffee_shop_id,id),
        CONSTRAINT UQ_tenant_crm_offers_promotion UNIQUE (coffee_shop_id,promotion_id),
        CONSTRAINT FK_tenant_crm_offers_promotion FOREIGN KEY (coffee_shop_id,promotion_id)
          REFERENCES promotions(coffee_shop_id,id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_offers_segment FOREIGN KEY (coffee_shop_id,segment_id)
          REFERENCES tenant_crm_segments(coffee_shop_id,id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_offers_creator FOREIGN KEY (coffee_shop_id,created_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT,
        CONSTRAINT CK_tenant_crm_offers_lifecycle CHECK (
          (status='DRAFT' AND activated_at IS NULL AND ended_at IS NULL AND segment_name_snapshot IS NULL AND segment_criteria_snapshot IS NULL) OR
          (status='ACTIVE' AND activated_at IS NOT NULL AND ended_at IS NULL AND segment_name_snapshot IS NOT NULL AND segment_criteria_snapshot IS NOT NULL) OR
          (status='ENDED' AND activated_at IS NOT NULL AND ended_at IS NOT NULL AND segment_name_snapshot IS NOT NULL AND segment_criteria_snapshot IS NOT NULL)
        ),
        CONSTRAINT CK_tenant_crm_offers_snapshot CHECK (segment_criteria_snapshot IS NULL OR jsonb_typeof(segment_criteria_snapshot)='object')
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_offers_list ON tenant_crm_offers(coffee_shop_id,status,updated_at DESC,id)`);
    await queryRunner.query(`
      CREATE TABLE tenant_crm_offer_audience_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        offer_id uuid NOT NULL,
        client_id uuid NOT NULL,
        granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT UQ_tenant_crm_offer_audience_member UNIQUE (coffee_shop_id,offer_id,client_id),
        CONSTRAINT UQ_tenant_crm_offer_audience_id UNIQUE (coffee_shop_id,id),
        CONSTRAINT FK_tenant_crm_offer_audience_offer FOREIGN KEY (coffee_shop_id,offer_id)
          REFERENCES tenant_crm_offers(coffee_shop_id,id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_offer_audience_client FOREIGN KEY (coffee_shop_id,client_id)
          REFERENCES clients(coffee_shop_id,id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_offer_audience_offer ON tenant_crm_offer_audience_members(coffee_shop_id,offer_id,granted_at DESC,id)`);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_offer_audience_client ON tenant_crm_offer_audience_members(coffee_shop_id,client_id,granted_at DESC,id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant_crm_offer_audience_members`);
    await queryRunner.query(`DROP TABLE tenant_crm_offers`);
  }
}
