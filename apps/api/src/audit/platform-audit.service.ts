import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

export interface PlatformAuditInput {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary?: Record<string, string | number | boolean | null>;
}

@Injectable()
export class PlatformAuditService {
  constructor(private readonly dataSource: DataSource) {}

  async record(input: PlatformAuditInput): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "platform_audit_events" ("actor_user_id", "action", "target_type", "target_id", "summary") VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [input.actorUserId, input.action, input.targetType, input.targetId, JSON.stringify(input.summary ?? {})],
    );
  }

  async list(limit = 50) {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT "id", "action", "target_type" AS "targetType", "target_id" AS "targetId", "summary", "created_at" AS "createdAt" FROM "platform_audit_events" ORDER BY "created_at" DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }
}
