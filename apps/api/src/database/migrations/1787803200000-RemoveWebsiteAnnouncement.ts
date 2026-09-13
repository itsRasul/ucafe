import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveWebsiteAnnouncement1787803200000 implements MigrationInterface {
  name = "RemoveWebsiteAnnouncement1787803200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "website_settings" DROP COLUMN "announcement_text"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "website_settings" ADD COLUMN "announcement_text" varchar(180)`);
  }
}
