import { MigrationInterface, QueryRunner } from "typeorm";

export class TenantCrmSegments1790620000000 implements MigrationInterface {
  name = "TenantCrmSegments1790620000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant_crm_segments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
        name varchar(120) NOT NULL CHECK (name=btrim(name) AND char_length(name) BETWEEN 1 AND 120),
        description varchar(500),
        criteria jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'object'),
        is_active boolean NOT NULL DEFAULT true,
        created_by_user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT UQ_tenant_crm_segments_tenant_id UNIQUE (coffee_shop_id,id),
        CONSTRAINT FK_tenant_crm_segments_creator FOREIGN KEY (coffee_shop_id,created_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_tenant_crm_segments_name ON tenant_crm_segments(coffee_shop_id,lower(name))`);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_segments_list ON tenant_crm_segments(coffee_shop_id,updated_at DESC,id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant_crm_segments`);
  }
}
