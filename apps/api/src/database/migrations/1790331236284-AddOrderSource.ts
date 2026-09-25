import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrderSource1790331236284 implements MigrationInterface {
  name = "AddOrderSource1790331236284";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "order_source" AS ENUM ('PUBLIC_CLIENT')`);
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN "order_source" "order_source"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "order_source"`);
    await queryRunner.query(`DROP TYPE "order_source"`);
  }
}
