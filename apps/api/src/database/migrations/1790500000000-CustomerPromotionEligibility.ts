import { MigrationInterface, QueryRunner } from "typeorm";

export class CustomerPromotionEligibility1790500000000 implements MigrationInterface {
  name = "CustomerPromotionEligibility1790500000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE clients ADD CONSTRAINT UQ_clients_tenant_id UNIQUE (coffee_shop_id, id)`);
    await queryRunner.query(`
      CREATE TABLE customer_segments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE RESTRICT,
        name varchar(100) NOT NULL,
        description varchar(500),
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT UQ_customer_segments_tenant_id UNIQUE (coffee_shop_id, id),
        CONSTRAINT CK_customer_segments_name CHECK (length(btrim(name)) > 0)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_customer_segments_tenant_name ON customer_segments (coffee_shop_id, lower(name)) WHERE deleted_at IS NULL`);
    await queryRunner.query(`CREATE INDEX IDX_customer_segments_tenant_active ON customer_segments (coffee_shop_id, is_active) WHERE deleted_at IS NULL`);
    await queryRunner.query(`
      CREATE TABLE customer_segment_memberships (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        segment_id uuid NOT NULL,
        client_id uuid NOT NULL,
        created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT UQ_customer_segment_memberships UNIQUE (coffee_shop_id, segment_id, client_id),
        CONSTRAINT FK_customer_segment_memberships_segment FOREIGN KEY (coffee_shop_id, segment_id) REFERENCES customer_segments(coffee_shop_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_customer_segment_memberships_client FOREIGN KEY (coffee_shop_id, client_id) REFERENCES clients(coffee_shop_id, id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_customer_segment_memberships_client ON customer_segment_memberships (coffee_shop_id, client_id)`);
    await queryRunner.query(`CREATE INDEX IDX_customer_segment_memberships_segment ON customer_segment_memberships (coffee_shop_id, segment_id)`);

    await queryRunner.query(`CREATE TYPE promotion_customer_condition_type AS ENUM ('FIRST_ORDER','ORDER_COUNT','TOTAL_SPENT','LAST_ORDER_AGE','REGISTRATION_AGE','CUSTOMER_SEGMENT')`);
    await queryRunner.query(`CREATE TYPE promotion_customer_condition_operator AS ENUM ('AT_LEAST','AT_MOST','EXACTLY','WITHIN_LAST')`);
    await queryRunner.query(`
      CREATE TABLE promotion_customer_conditions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        promotion_id uuid NOT NULL,
        condition_type promotion_customer_condition_type NOT NULL,
        operator promotion_customer_condition_operator,
        value bigint,
        customer_segment_id uuid,
        CONSTRAINT UQ_promotion_customer_conditions_type UNIQUE (coffee_shop_id, promotion_id, condition_type),
        CONSTRAINT FK_promotion_customer_conditions_promotion FOREIGN KEY (coffee_shop_id, promotion_id) REFERENCES promotions(coffee_shop_id, id) ON DELETE CASCADE,
        CONSTRAINT FK_promotion_customer_conditions_segment FOREIGN KEY (coffee_shop_id, customer_segment_id) REFERENCES customer_segments(coffee_shop_id, id) ON DELETE RESTRICT,
        CONSTRAINT CK_promotion_customer_conditions_shape CHECK (
          (condition_type = 'FIRST_ORDER' AND operator IS NULL AND value IS NULL AND customer_segment_id IS NULL) OR
          (condition_type = 'ORDER_COUNT' AND operator IN ('AT_LEAST','AT_MOST','EXACTLY') AND value >= 0 AND customer_segment_id IS NULL) OR
          (condition_type = 'TOTAL_SPENT' AND operator = 'AT_LEAST' AND value >= 0 AND customer_segment_id IS NULL) OR
          (condition_type = 'LAST_ORDER_AGE' AND operator = 'AT_LEAST' AND value BETWEEN 1 AND 36500 AND customer_segment_id IS NULL) OR
          (condition_type = 'REGISTRATION_AGE' AND operator IN ('AT_LEAST','WITHIN_LAST') AND value BETWEEN 1 AND 36500 AND customer_segment_id IS NULL) OR
          (condition_type = 'CUSTOMER_SEGMENT' AND operator IS NULL AND value IS NULL AND customer_segment_id IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_promotion_customer_conditions_segment ON promotion_customer_conditions (coffee_shop_id, customer_segment_id) WHERE customer_segment_id IS NOT NULL`);

    await queryRunner.query(`ALTER TABLE orders ADD COLUMN customer_promotion_snapshot jsonb`);
    await queryRunner.query(`ALTER TABLE orders ADD CONSTRAINT CK_orders_customer_promotion_snapshot CHECK (customer_promotion_snapshot IS NULL OR jsonb_typeof(customer_promotion_snapshot) = 'array')`);

    await queryRunner.query(`ALTER TABLE promotion_redemptions DROP CONSTRAINT UQ_promotion_redemptions_order`);
    await queryRunner.query(`ALTER TABLE promotion_redemptions ALTER COLUMN coupon_id DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE promotion_redemptions ADD COLUMN is_first_order_claim boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE promotion_redemptions ADD CONSTRAINT CK_promotion_redemptions_first_order_claim CHECK (coupon_id IS NOT NULL OR is_first_order_claim)`);
    await queryRunner.query(`CREATE INDEX IDX_promotion_redemptions_order ON promotion_redemptions (order_id)`);
    await queryRunner.query(`CREATE INDEX IDX_promotion_redemptions_promotion_customer_status ON promotion_redemptions (coffee_shop_id, promotion_id, customer_id, status)`);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_promotion_redemptions_first_order_claim ON promotion_redemptions (coffee_shop_id, promotion_id, customer_id) WHERE is_first_order_claim AND status = 'APPLIED'`);

    await queryRunner.query(`DROP TRIGGER TRG_promotion_redemption_tenant_scope ON promotion_redemptions`);
    await queryRunner.query(`DROP FUNCTION enforce_promotion_redemption_tenant_scope()`);
    await queryRunner.query(`CREATE FUNCTION enforce_promotion_redemption_tenant_scope() RETURNS trigger AS $$
      DECLARE claim_is_new boolean;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM promotions p WHERE p.id = NEW.promotion_id AND p.coffee_shop_id = NEW.coffee_shop_id) THEN RAISE EXCEPTION 'promotion redemption promotion tenant mismatch'; END IF;
        IF NEW.coupon_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM promotion_coupons c WHERE c.id = NEW.coupon_id AND c.coffee_shop_id = NEW.coffee_shop_id AND c.promotion_id = NEW.promotion_id) THEN RAISE EXCEPTION 'promotion redemption coupon tenant mismatch'; END IF;
        IF NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = NEW.customer_id AND c.coffee_shop_id = NEW.coffee_shop_id) THEN RAISE EXCEPTION 'promotion redemption customer tenant mismatch'; END IF;
        IF NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.coffee_shop_id = NEW.coffee_shop_id AND o.client_id = NEW.customer_id) THEN RAISE EXCEPTION 'promotion redemption order tenant mismatch'; END IF;
        IF NEW.coupon_id IS NULL AND NOT NEW.is_first_order_claim THEN RAISE EXCEPTION 'coupon-less redemption must claim a first-order promotion'; END IF;
        IF TG_OP = 'INSERT' THEN claim_is_new := NEW.is_first_order_claim; ELSE claim_is_new := NEW.is_first_order_claim AND NOT OLD.is_first_order_claim; END IF;
        IF claim_is_new AND NOT EXISTS (SELECT 1 FROM promotion_customer_conditions cc WHERE cc.coffee_shop_id = NEW.coffee_shop_id AND cc.promotion_id = NEW.promotion_id AND cc.condition_type = 'FIRST_ORDER') THEN RAISE EXCEPTION 'first-order claim requires a first-order condition'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER TRG_promotion_redemption_tenant_scope BEFORE INSERT OR UPDATE ON promotion_redemptions FOR EACH ROW EXECUTE FUNCTION enforce_promotion_redemption_tenant_scope()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER TRG_promotion_redemption_tenant_scope ON promotion_redemptions`);
    await queryRunner.query(`DROP FUNCTION enforce_promotion_redemption_tenant_scope()`);
    await queryRunner.query(`DELETE FROM promotion_redemptions WHERE coupon_id IS NULL`);
    await queryRunner.query(`DROP INDEX UQ_promotion_redemptions_first_order_claim`);
    await queryRunner.query(`DROP INDEX IDX_promotion_redemptions_promotion_customer_status`);
    await queryRunner.query(`DROP INDEX IDX_promotion_redemptions_order`);
    await queryRunner.query(`ALTER TABLE promotion_redemptions DROP CONSTRAINT CK_promotion_redemptions_first_order_claim`);
    await queryRunner.query(`ALTER TABLE promotion_redemptions DROP COLUMN is_first_order_claim`);
    await queryRunner.query(`ALTER TABLE promotion_redemptions ALTER COLUMN coupon_id SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE promotion_redemptions ADD CONSTRAINT UQ_promotion_redemptions_order UNIQUE (order_id)`);
    await queryRunner.query(`CREATE FUNCTION enforce_promotion_redemption_tenant_scope() RETURNS trigger AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM promotion_coupons c WHERE c.id = NEW.coupon_id AND c.coffee_shop_id = NEW.coffee_shop_id AND c.promotion_id = NEW.promotion_id) OR NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = NEW.customer_id AND c.coffee_shop_id = NEW.coffee_shop_id) OR NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.coffee_shop_id = NEW.coffee_shop_id AND o.client_id = NEW.customer_id) THEN RAISE EXCEPTION 'promotion redemption tenant mismatch'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER TRG_promotion_redemption_tenant_scope BEFORE INSERT OR UPDATE ON promotion_redemptions FOR EACH ROW EXECUTE FUNCTION enforce_promotion_redemption_tenant_scope()`);
    await queryRunner.query(`ALTER TABLE orders DROP CONSTRAINT CK_orders_customer_promotion_snapshot`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN customer_promotion_snapshot`);
    await queryRunner.query(`DROP INDEX IDX_promotion_customer_conditions_segment`);
    await queryRunner.query(`DROP TABLE promotion_customer_conditions`);
    await queryRunner.query(`DROP TYPE promotion_customer_condition_operator`);
    await queryRunner.query(`DROP TYPE promotion_customer_condition_type`);
    await queryRunner.query(`DROP INDEX IDX_customer_segment_memberships_segment`);
    await queryRunner.query(`DROP INDEX IDX_customer_segment_memberships_client`);
    await queryRunner.query(`DROP TABLE customer_segment_memberships`);
    await queryRunner.query(`DROP INDEX IDX_customer_segments_tenant_active`);
    await queryRunner.query(`DROP INDEX UQ_customer_segments_tenant_name`);
    await queryRunner.query(`DROP TABLE customer_segments`);
    await queryRunner.query(`ALTER TABLE clients DROP CONSTRAINT UQ_clients_tenant_id`);
  }
}
