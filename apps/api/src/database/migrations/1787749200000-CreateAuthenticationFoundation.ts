import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuthenticationFoundation1787749200000 implements MigrationInterface {
  name = "CreateAuthenticationFoundation1787749200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "otp_purpose" AS ENUM ('LOGIN')`);
    await queryRunner.query(`CREATE TYPE "otp_challenge_status" AS ENUM ('PENDING','VERIFIED','EXPIRED','LOCKED','CANCELLED')`);

    await queryRunner.query(`
      CREATE TABLE "otp_challenges" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "phone_hash" char(64) NOT NULL,
        "phone_ciphertext" text NOT NULL,
        "otp_hash" char(64) NOT NULL,
        "purpose" otp_purpose NOT NULL DEFAULT 'LOGIN',
        "status" otp_challenge_status NOT NULL DEFAULT 'PENDING',
        "attempts" smallint NOT NULL DEFAULT 0,
        "max_attempts" smallint NOT NULL DEFAULT 5,
        "expires_at" timestamptz NOT NULL,
        "resend_available_at" timestamptz NOT NULL,
        "requested_ip_hash" char(64),
        "requested_user_agent_hash" char(64),
        "consumed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_otp_attempts" CHECK (attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts),
        CONSTRAINT "CK_otp_expiry" CHECK (expires_at > created_at)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_otp_challenges_phone_created" ON "otp_challenges" ("phone_hash","created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_otp_challenges_ip_created" ON "otp_challenges" ("requested_ip_hash","created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_otp_challenges_pending_expiry" ON "otp_challenges" ("expires_at") WHERE "status" = 'PENDING'`);

    await queryRunner.query(`
      CREATE TABLE "auth_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "token_family_id" uuid NOT NULL,
        "refresh_token_hash" char(64) NOT NULL,
        "parent_session_id" uuid,
        "replaced_by_session_id" uuid,
        "ip_hash" char(64),
        "user_agent_hash" char(64),
        "expires_at" timestamptz NOT NULL,
        "last_used_at" timestamptz,
        "rotated_at" timestamptz,
        "revoked_at" timestamptz,
        "compromised_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_auth_sessions_refresh_hash" UNIQUE ("refresh_token_hash"),
        CONSTRAINT "FK_auth_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_auth_sessions_parent" FOREIGN KEY ("parent_session_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_auth_sessions_replacement" FOREIGN KEY ("replaced_by_session_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_auth_sessions_replacement" UNIQUE ("replaced_by_session_id"),
        CONSTRAINT "CK_auth_sessions_expiry" CHECK (expires_at > created_at)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_auth_sessions_user_active" ON "auth_sessions" ("user_id") WHERE "revoked_at" IS NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_auth_sessions_active_family" ON "auth_sessions" ("token_family_id") WHERE "revoked_at" IS NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_auth_sessions_expiry" ON "auth_sessions" ("expires_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "auth_sessions"`);
    await queryRunner.query(`DROP TABLE "otp_challenges"`);
    await queryRunner.query(`DROP TYPE "otp_challenge_status"`);
    await queryRunner.query(`DROP TYPE "otp_purpose"`);
  }
}
