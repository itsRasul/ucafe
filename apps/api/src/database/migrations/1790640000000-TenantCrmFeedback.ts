import { MigrationInterface, QueryRunner } from "typeorm";

export class TenantCrmFeedback1790640000000 implements MigrationInterface {
  name = "TenantCrmFeedback1790640000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE orders ADD CONSTRAINT UQ_orders_tenant_client_id UNIQUE(coffee_shop_id,id,client_id)`);
    await queryRunner.query(`ALTER TABLE reservations ADD CONSTRAINT UQ_reservations_tenant_client_id UNIQUE(coffee_shop_id,id,client_id)`);
    await queryRunner.query(`
      CREATE TABLE tenant_crm_feedback (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
        client_id uuid NOT NULL,
        rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment varchar(4000) CHECK (comment IS NULL OR char_length(btrim(comment)) BETWEEN 1 AND 4000),
        source varchar(20) NOT NULL CHECK (source IN ('MANUAL','CUSTOMER_PANEL')),
        order_id uuid,
        reservation_id uuid,
        status varchar(20) NOT NULL CHECK (status IN ('NEW','NEEDS_ATTENTION','RESOLVED')),
        created_by_user_id uuid,
        resolved_by_user_id uuid,
        resolution_note varchar(1000),
        resolved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT UQ_tenant_crm_feedback_tenant_id UNIQUE(coffee_shop_id,id),
        CONSTRAINT CK_tenant_crm_feedback_source_relation CHECK (
          (order_id IS NULL OR reservation_id IS NULL) AND
          (source <> 'CUSTOMER_PANEL' OR num_nonnulls(order_id,reservation_id)=1) AND
          ((source='MANUAL' AND created_by_user_id IS NOT NULL) OR
           (source='CUSTOMER_PANEL' AND created_by_user_id IS NULL))
        ),
        CONSTRAINT CK_tenant_crm_feedback_resolution CHECK (
          (status='RESOLVED' AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL) OR
          (status<>'RESOLVED' AND resolved_at IS NULL AND resolved_by_user_id IS NULL AND resolution_note IS NULL)
        ),
        CONSTRAINT FK_tenant_crm_feedback_client FOREIGN KEY(coffee_shop_id,client_id)
          REFERENCES clients(coffee_shop_id,id) ON DELETE CASCADE,
        CONSTRAINT FK_tenant_crm_feedback_order_client FOREIGN KEY(coffee_shop_id,order_id,client_id)
          REFERENCES orders(coffee_shop_id,id,client_id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_feedback_reservation_client FOREIGN KEY(coffee_shop_id,reservation_id,client_id)
          REFERENCES reservations(coffee_shop_id,id,client_id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_feedback_creator FOREIGN KEY(coffee_shop_id,created_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_feedback_resolver FOREIGN KEY(coffee_shop_id,resolved_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_feedback_created ON tenant_crm_feedback(coffee_shop_id,created_at DESC,id DESC)`);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_feedback_status_created ON tenant_crm_feedback(coffee_shop_id,status,created_at DESC,id DESC)`);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_feedback_client_created ON tenant_crm_feedback(coffee_shop_id,client_id,created_at DESC,id DESC)`);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_tenant_crm_feedback_order ON tenant_crm_feedback(coffee_shop_id,order_id) WHERE order_id IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_tenant_crm_feedback_reservation ON tenant_crm_feedback(coffee_shop_id,reservation_id) WHERE reservation_id IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant_crm_feedback`);
    await queryRunner.query(`ALTER TABLE reservations DROP CONSTRAINT UQ_reservations_tenant_client_id`);
    await queryRunner.query(`ALTER TABLE orders DROP CONSTRAINT UQ_orders_tenant_client_id`);
  }
}
