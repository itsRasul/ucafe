import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPromotionCoupons1790427600000 implements MigrationInterface {
  name = "AddPromotionCoupons1790427600000";
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE promotions ADD COLUMN entire_order boolean NOT NULL DEFAULT false, ADD COLUMN minimum_subtotal_toman bigint, ADD COLUMN max_discount_toman bigint`);
    await q.query(`ALTER TABLE promotions ADD CONSTRAINT CK_promotions_order_rules CHECK ((minimum_subtotal_toman IS NULL OR minimum_subtotal_toman >= 0) AND (max_discount_toman IS NULL OR max_discount_toman > 0) AND (NOT entire_order OR reward_type <> 'FIXED_PRICE'))`);
    await q.query(`CREATE TABLE promotion_coupons (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL, promotion_id uuid NOT NULL, code varchar(64) NOT NULL, normalized_code varchar(64) NOT NULL, is_active boolean NOT NULL DEFAULT true, starts_at timestamptz, expires_at timestamptz, total_usage_limit integer, per_customer_usage_limit integer, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT UQ_promotion_coupons_tenant_code UNIQUE (coffee_shop_id, normalized_code), CONSTRAINT UQ_promotion_coupons_promotion UNIQUE (promotion_id), CONSTRAINT FK_promotion_coupons_promotion FOREIGN KEY (coffee_shop_id, promotion_id) REFERENCES promotions(coffee_shop_id, id) ON DELETE RESTRICT, CONSTRAINT CK_promotion_coupons_limits CHECK ((total_usage_limit IS NULL OR total_usage_limit > 0) AND (per_customer_usage_limit IS NULL OR per_customer_usage_limit > 0) AND (starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at)))`);
    await q.query(`CREATE TYPE promotion_redemption_status AS ENUM ('APPLIED','RELEASED')`);
    await q.query(`CREATE TABLE promotion_redemptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL, promotion_id uuid NOT NULL, coupon_id uuid NOT NULL, customer_id uuid NOT NULL, order_id uuid NOT NULL, discount_amount_toman bigint NOT NULL, status promotion_redemption_status NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT UQ_promotion_redemptions_order UNIQUE (order_id), CONSTRAINT FK_promotion_redemptions_coupon FOREIGN KEY (coupon_id) REFERENCES promotion_coupons(id) ON DELETE RESTRICT, CONSTRAINT FK_promotion_redemptions_promotion FOREIGN KEY (coffee_shop_id, promotion_id) REFERENCES promotions(coffee_shop_id, id) ON DELETE RESTRICT, CONSTRAINT FK_promotion_redemptions_customer FOREIGN KEY (customer_id) REFERENCES clients(id) ON DELETE RESTRICT, CONSTRAINT FK_promotion_redemptions_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT, CONSTRAINT CK_promotion_redemptions_discount CHECK (discount_amount_toman > 0))`);
    await q.query(`CREATE INDEX IDX_promotion_redemptions_coupon_status ON promotion_redemptions(coupon_id, status)`);
    await q.query(`CREATE INDEX IDX_promotion_redemptions_customer_status ON promotion_redemptions(coupon_id, customer_id, status)`);
    await q.query(`CREATE FUNCTION enforce_promotion_redemption_tenant_scope() RETURNS trigger AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM promotion_coupons c WHERE c.id = NEW.coupon_id AND c.coffee_shop_id = NEW.coffee_shop_id AND c.promotion_id = NEW.promotion_id) OR NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = NEW.customer_id AND c.coffee_shop_id = NEW.coffee_shop_id) OR NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.coffee_shop_id = NEW.coffee_shop_id AND o.client_id = NEW.customer_id) THEN RAISE EXCEPTION 'promotion redemption tenant mismatch'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_promotion_redemption_tenant_scope BEFORE INSERT OR UPDATE ON promotion_redemptions FOR EACH ROW EXECUTE FUNCTION enforce_promotion_redemption_tenant_scope()`);
    await q.query(`ALTER TABLE orders ADD COLUMN order_discount_toman bigint NOT NULL DEFAULT 0, ADD COLUMN order_promotion_id_snapshot uuid, ADD COLUMN order_promotion_name_snapshot varchar(120), ADD COLUMN order_promotion_reward_type_snapshot varchar(20), ADD COLUMN order_promotion_reward_value_snapshot bigint, ADD COLUMN coupon_code_snapshot varchar(64)`);
    await q.query(`ALTER TABLE orders ADD CONSTRAINT CK_orders_order_discount CHECK (order_discount_toman >= 0 AND order_discount_toman <= discount_total_toman)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE orders DROP CONSTRAINT CK_orders_order_discount, DROP COLUMN coupon_code_snapshot, DROP COLUMN order_promotion_reward_value_snapshot, DROP COLUMN order_promotion_reward_type_snapshot, DROP COLUMN order_promotion_name_snapshot, DROP COLUMN order_promotion_id_snapshot, DROP COLUMN order_discount_toman`);
    await q.query(`DROP TRIGGER TRG_promotion_redemption_tenant_scope ON promotion_redemptions`);
    await q.query(`DROP FUNCTION enforce_promotion_redemption_tenant_scope()`);
    await q.query(`DROP TABLE promotion_redemptions`);
    await q.query(`DROP TYPE promotion_redemption_status`);
    await q.query(`DROP TABLE promotion_coupons`);
    await q.query(`ALTER TABLE promotions DROP CONSTRAINT CK_promotions_order_rules, DROP COLUMN max_discount_toman, DROP COLUMN minimum_subtotal_toman, DROP COLUMN entire_order`);
  }
}
