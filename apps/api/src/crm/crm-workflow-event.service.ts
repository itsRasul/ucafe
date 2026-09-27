import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { EntityManager } from "typeorm";
import { CrmWorkflowEventType, CrmWorkflowRecordType } from "./crm-workflow.util";

type SubjectType = CrmWorkflowRecordType | "ACTIVITY" | "TASK";
type Row = Record<string, any>;

@Injectable()
export class CrmWorkflowEventService {
  async record(manager: EntityManager, input: {
    eventType: CrmWorkflowEventType;
    subjectType: SubjectType;
    subjectId: string;
    eventContext?: Record<string, unknown>;
    sourceKey?: string;
    targetWorkflowId?: string;
    recordContext?: Record<string, string | null>;
  }) {
    const [recordContext, causation] = await Promise.all([
      input.recordContext ? Promise.resolve(input.recordContext) : this.resolveRecordContext(manager, input.subjectType, input.subjectId),
      manager.query<Row[]>(`SELECT
        NULLIF(current_setting('ucafe.crm_automation_correlation_id',true),'') AS "correlationId",
        NULLIF(current_setting('ucafe.crm_automation_execution_id',true),'') AS "causationExecutionId",
        NULLIF(current_setting('ucafe.crm_automation_depth',true),'') AS "automationDepth"`),
    ]);
    const parent = causation[0] ?? {};
    const eventId = randomUUID();
    const sourceKey = input.sourceKey ?? `source:${eventId}`;
    const correlationId = parent.correlationId ?? randomUUID();
    const depth = parent.automationDepth == null ? 0 : Number(parent.automationDepth);
    const rows = await manager.query<Row[]>(`
      INSERT INTO crm_workflow_events(source_key,event_type,subject_type,subject_id,record_context,event_context,target_workflow_id,
        correlation_id,causation_execution_id,automation_depth)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10)
      ON CONFLICT(source_key) DO NOTHING RETURNING id
    `, [sourceKey, input.eventType, input.subjectType, input.subjectId, JSON.stringify(recordContext), JSON.stringify(input.eventContext ?? {}),
      input.targetWorkflowId ?? null, correlationId, parent.causationExecutionId ?? null, depth]);
    if (rows[0]) return rows[0].id as string;
    const existing = await manager.query<Row[]>("SELECT id FROM crm_workflow_events WHERE source_key=$1", [sourceKey]);
    return existing[0]?.id as string | undefined;
  }

  private async resolveRecordContext(manager: EntityManager, type: SubjectType, id: string): Promise<Record<string, string | null>> {
    const queries: Record<SubjectType, string> = {
      ORGANIZATION: "SELECT id AS \"organizationId\" FROM crm_organizations WHERE id=$1",
      LEAD: "SELECT id AS \"leadId\",organization_id AS \"organizationId\",primary_contact_id AS \"contactId\" FROM crm_leads WHERE id=$1",
      DEAL: "SELECT id AS \"dealId\",organization_id AS \"organizationId\",primary_contact_id AS \"contactId\",originating_lead_id AS \"leadId\" FROM crm_deals WHERE id=$1",
      ACTIVITY: `SELECT a.organization_id AS \"organizationId\",a.contact_id AS \"contactId\",a.lead_id AS \"leadId\",a.deal_id AS \"dealId\",
        COALESCE(a.organization_id,l.organization_id,d.organization_id,c.organization_id) AS \"resolvedOrganizationId\"
        FROM crm_activities a LEFT JOIN crm_leads l ON l.id=a.lead_id LEFT JOIN crm_deals d ON d.id=a.deal_id LEFT JOIN crm_contacts c ON c.id=a.contact_id WHERE a.id=$1`,
      TASK: `SELECT t.organization_id AS \"organizationId\",t.contact_id AS \"contactId\",t.lead_id AS \"leadId\",t.deal_id AS \"dealId\",
        COALESCE(t.organization_id,l.organization_id,d.organization_id,c.organization_id) AS \"resolvedOrganizationId\"
        FROM crm_tasks t LEFT JOIN crm_leads l ON l.id=t.lead_id LEFT JOIN crm_deals d ON d.id=t.deal_id LEFT JOIN crm_contacts c ON c.id=t.contact_id WHERE t.id=$1`,
    };
    const row = (await manager.query<Row[]>(queries[type], [id]))[0] ?? {};
    return {
      organizationId: row.resolvedOrganizationId ?? row.organizationId ?? null,
      contactId: row.contactId ?? null,
      leadId: row.leadId ?? null,
      dealId: row.dealId ?? null,
    };
  }
}
