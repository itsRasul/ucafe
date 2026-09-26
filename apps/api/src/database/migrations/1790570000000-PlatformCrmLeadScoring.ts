import { MigrationInterface, QueryRunner } from "typeorm";

export class PlatformCrmLeadScoring1790570000000 implements MigrationInterface {
  name = "PlatformCrmLeadScoring1790570000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE crm_scoring_state (
        id smallint PRIMARY KEY CHECK (id = 1),
        version integer NOT NULL DEFAULT 1 CHECK (version > 0)
      );
      INSERT INTO crm_scoring_state(id, version) VALUES (1, 1);

      CREATE TABLE crm_scoring_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
        description varchar(500),
        category varchar(16) NOT NULL CHECK (category IN ('FIT','ENGAGEMENT')),
        criteria jsonb NOT NULL,
        points integer NOT NULL CHECK (points BETWEEN -100 AND 100),
        enabled boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
        created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_crm_scoring_rules_active ON crm_scoring_rules(category, sort_order, id) WHERE archived_at IS NULL AND enabled = true;

      CREATE TABLE crm_lead_scores (
        lead_id uuid PRIMARY KEY REFERENCES crm_leads(id) ON DELETE RESTRICT,
        fit_score smallint NOT NULL DEFAULT 0 CHECK (fit_score BETWEEN 0 AND 100),
        engagement_score smallint NOT NULL DEFAULT 0 CHECK (engagement_score BETWEEN 0 AND 100),
        overall_score smallint NOT NULL DEFAULT 0 CHECK (overall_score BETWEEN 0 AND 100),
        configured boolean NOT NULL DEFAULT false,
        scoring_version integer NOT NULL DEFAULT 1,
        breakdown jsonb NOT NULL DEFAULT '{"fit":{"rawTotal":0,"score":0,"contributions":[]},"engagement":{"rawTotal":0,"score":0,"contributions":[]}}'::jsonb,
        calculated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_crm_lead_scores_overall ON crm_lead_scores(overall_score DESC, lead_id);
      CREATE INDEX idx_crm_lead_scores_fit ON crm_lead_scores(fit_score DESC, lead_id);
      CREATE INDEX idx_crm_lead_scores_engagement ON crm_lead_scores(engagement_score DESC, lead_id);

      CREATE TABLE crm_lead_score_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id uuid NOT NULL REFERENCES crm_leads(id) ON DELETE RESTRICT,
        fit_score smallint NOT NULL CHECK (fit_score BETWEEN 0 AND 100),
        engagement_score smallint NOT NULL CHECK (engagement_score BETWEEN 0 AND 100),
        overall_score smallint NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
        previous_overall_score smallint CHECK (previous_overall_score BETWEEN 0 AND 100),
        scoring_version integer NOT NULL,
        reason varchar(32) NOT NULL,
        breakdown jsonb NOT NULL,
        calculated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_crm_lead_score_history_lead_time ON crm_lead_score_history(lead_id, calculated_at DESC, id DESC);

      INSERT INTO crm_lead_scores(lead_id, scoring_version, configured)
      SELECT id, 1, false FROM crm_leads ON CONFLICT (lead_id) DO NOTHING;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE crm_lead_score_history; DROP TABLE crm_lead_scores; DROP TABLE crm_scoring_rules; DROP TABLE crm_scoring_state;`);
  }
}
