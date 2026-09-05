import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWebsiteContentFoundation1787756400000 implements MigrationInterface {
  name = "CreateWebsiteContentFoundation1787756400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "website_radius_preset" AS ENUM ('SOFT','ROUNDED','EDITORIAL')`);
    await queryRunner.query(`
      CREATE TABLE "website_settings" (
        "coffee_shop_id" uuid PRIMARY KEY REFERENCES "coffee_shops"("id") ON DELETE CASCADE,
        "template_key" varchar(40) NOT NULL DEFAULT 'warm-editorial',
        "hero_title" varchar(140),
        "hero_subtitle" varchar(320),
        "about_title" varchar(140),
        "about_body" text,
        "announcement_text" varchar(180),
        "instagram_url" varchar(300),
        "primary_color" char(7) NOT NULL DEFAULT '#6F4E37',
        "secondary_color" char(7) NOT NULL DEFAULT '#F4EEE4',
        "accent_color" char(7) NOT NULL DEFAULT '#A85F35',
        "heading_font" varchar(40) NOT NULL DEFAULT 'Estedad',
        "body_font" varchar(40) NOT NULL DEFAULT 'Vazirmatn',
        "radius_preset" website_radius_preset NOT NULL DEFAULT 'SOFT',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_website_settings_colors" CHECK (primary_color ~ '^#[0-9A-F]{6}$' AND secondary_color ~ '^#[0-9A-F]{6}$' AND accent_color ~ '^#[0-9A-F]{6}$')
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "branch_opening_hours" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
        "day_of_week" smallint NOT NULL,
        "is_closed" boolean NOT NULL DEFAULT false,
        "opens_at" time,
        "closes_at" time,
        CONSTRAINT "UQ_branch_opening_hours_day" UNIQUE (branch_id, day_of_week),
        CONSTRAINT "CK_branch_opening_hours_day" CHECK (day_of_week BETWEEN 0 AND 6),
        CONSTRAINT "CK_branch_opening_hours_values" CHECK ((is_closed AND opens_at IS NULL AND closes_at IS NULL) OR (NOT is_closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at))
      )
    `);
    await queryRunner.query(`INSERT INTO "website_settings" ("coffee_shop_id") SELECT "id" FROM "coffee_shops" ON CONFLICT DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "branch_opening_hours"`);
    await queryRunner.query(`DROP TABLE "website_settings"`);
    await queryRunner.query(`DROP TYPE "website_radius_preset"`);
  }
}
