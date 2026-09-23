import { MigrationInterface, QueryRunner } from "typeorm";

export class SnapshotOrderItemCategory1787828400000 implements MigrationInterface {
  name = "SnapshotOrderItemCategory1787828400000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "category_id_snapshot" uuid`);
    await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "category_name_snapshot" varchar(100)`);
    await queryRunner.query(`
      UPDATE "order_items" oi
      SET "category_id_snapshot" = mi."category_id", "category_name_snapshot" = mc."name"
      FROM "menu_items" mi JOIN "menu_categories" mc ON mc."id" = mi."category_id"
      WHERE oi."menu_item_id" = mi."id"
        AND oi."coffee_shop_id" = mi."coffee_shop_id"
        AND mc."coffee_shop_id" = oi."coffee_shop_id"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "category_name_snapshot"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "category_id_snapshot"`);
  }
}
