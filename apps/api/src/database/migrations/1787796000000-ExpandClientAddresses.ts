import { MigrationInterface, QueryRunner } from "typeorm";

export class ExpandClientAddresses1787796000000 implements MigrationInterface {
  name = "ExpandClientAddresses1787796000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "client_addresses" ADD COLUMN "province" varchar(80), ADD COLUMN "city" varchar(80), ADD COLUMN "building_number" varchar(20), ADD COLUMN "unit" varchar(20), ADD COLUMN "postal_code" varchar(10)`);
    await queryRunner.query(`ALTER TABLE "client_addresses" ADD CONSTRAINT "CK_client_addresses_postal_code" CHECK ("postal_code" IS NULL OR "postal_code" ~ '^[0-9]{10}$')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "client_addresses" DROP CONSTRAINT "CK_client_addresses_postal_code"`);
    await queryRunner.query(`ALTER TABLE "client_addresses" DROP COLUMN "postal_code", DROP COLUMN "unit", DROP COLUMN "building_number", DROP COLUMN "city", DROP COLUMN "province"`);
  }
}
