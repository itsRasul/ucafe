import { MigrationInterface, QueryRunner } from "typeorm";

export class ProtectPublishedRecipeVersions1787847600000 implements MigrationInterface {
  name = "ProtectPublishedRecipeVersions1787847600000";

  async up(q: QueryRunner) {
    await q.query(`CREATE FUNCTION protect_published_inventory_recipe_version() RETURNS trigger AS $$
      BEGIN
        IF OLD.status='DRAFT' THEN RETURN NEW; END IF;
        IF OLD.status='ACTIVE' AND NEW.status='SUPERSEDED'
          AND (to_jsonb(OLD)-'status'-'updated_at')=(to_jsonb(NEW)-'status'-'updated_at') THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'published recipe versions are immutable';
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_recipe_versions_immutable BEFORE UPDATE ON inventory_recipe_versions FOR EACH ROW EXECUTE FUNCTION protect_published_inventory_recipe_version()`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_recipe_versions_immutable ON inventory_recipe_versions`);
    await q.query(`DROP FUNCTION IF EXISTS protect_published_inventory_recipe_version()`);
  }
}
