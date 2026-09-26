import { Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";

type Row = Record<string, any>;

@Injectable()
export class CrmOrganization360Service {
  constructor(private readonly dataSource: DataSource) {}

  async overview(organizationId: string) {
    const organizations = await this.dataSource.query<Array<{ id: string }>>(
      "SELECT id FROM crm_organizations WHERE id=$1", [organizationId],
    );
    if (!organizations[0]) throw new NotFoundException("CRM Organization not found");

    const reads = await Promise.allSettled([
      this.dataSource.query<Row[]>(`
        SELECT
          (SELECT count(*)::int FROM crm_contacts WHERE organization_id=$1 AND archived_at IS NULL) AS "contactCount",
          (SELECT count(*)::int FROM crm_leads WHERE organization_id=$1) AS "leadCount",
          (SELECT count(*)::int FROM crm_deals WHERE organization_id=$1 AND archived_at IS NULL) AS "dealCount",
          (SELECT count(*)::int FROM crm_deals WHERE organization_id=$1 AND status='OPEN' AND archived_at IS NULL) AS "openDealCount",
          (SELECT count(*)::int FROM crm_tasks t LEFT JOIN crm_leads l ON l.id=t.lead_id
            WHERE (t.organization_id=$1 OR l.organization_id=$1) AND t.status='OPEN' AND t.archived_at IS NULL) AS "openTaskCount"
      `, [organizationId]),
      this.dataSource.query<Row[]>(`
        SELECT l.id,l.business_name AS "businessName",l.status,l.source,l.owner_id AS "ownerId",
          ${this.actorLabelSql("u")} AS "ownerLabel",l.primary_contact_id AS "primaryContactId",
          c.name AS "primaryContactName",l.archived_at AS "archivedAt",l.created_at AS "createdAt"
        FROM crm_leads l LEFT JOIN users u ON u.id=l.owner_id LEFT JOIN crm_contacts c ON c.id=l.primary_contact_id
        WHERE l.organization_id=$1 ORDER BY l.created_at DESC,l.id DESC LIMIT 6
      `, [organizationId]),
      this.dataSource.query<Row[]>(`
        SELECT d.id,d.title,d.stage,d.status,d.expected_plan_id AS "expectedPlanId",p.name AS "expectedPlanName",
          d.estimated_amount_toman AS "estimatedAmountToman",d.expected_close_date AS "expectedCloseDate",
          d.owner_id AS "ownerId",${this.actorLabelSql("u")} AS "ownerLabel",d.primary_contact_id AS "primaryContactId",
          c.name AS "primaryContactName",d.archived_at AS "archivedAt",d.created_at AS "createdAt"
        FROM crm_deals d LEFT JOIN subscription_plans p ON p.id=d.expected_plan_id
        LEFT JOIN users u ON u.id=d.owner_id LEFT JOIN crm_contacts c ON c.id=d.primary_contact_id
        WHERE d.organization_id=$1 ORDER BY d.created_at DESC,d.id DESC LIMIT 6
      `, [organizationId]),
      this.dataSource.query<Row[]>(`
        SELECT t.id,t.title,t.kind,t.status,t.priority,t.due_at AS "dueAt",t.assigned_to_user_id AS "assignedToUserId",
          ${this.actorLabelSql("u")} AS "assigneeLabel",t.created_at AS "createdAt",
          (t.due_at IS NOT NULL AND t.due_at < now()) AS overdue
        FROM crm_tasks t LEFT JOIN crm_leads l ON l.id=t.lead_id LEFT JOIN users u ON u.id=t.assigned_to_user_id
        WHERE (t.organization_id=$1 OR l.organization_id=$1) AND t.status='OPEN' AND t.archived_at IS NULL
        ORDER BY t.due_at ASC NULLS LAST,t.id ASC LIMIT 6
      `, [organizationId]),
      this.dataSource.query<Row[]>(`
        SELECT a.id,a.activity_type AS "activityType",a.subject,a.details,a.occurred_at AS "occurredAt",a.outcome,
          a.contact_id AS "contactId",c.name AS "contactName",a.deal_id AS "dealId",d.title AS "dealTitle",
          ${this.actorLabelSql("u")} AS "actorLabel"
        FROM crm_activities a LEFT JOIN crm_contacts c ON c.id=a.contact_id LEFT JOIN crm_leads l ON l.id=a.lead_id
        LEFT JOIN crm_deals d ON d.id=a.deal_id LEFT JOIN users u ON u.id=a.actor_user_id
        WHERE COALESCE(a.organization_id,c.organization_id,l.organization_id,d.organization_id)=$1 AND a.archived_at IS NULL
        ORDER BY a.occurred_at DESC,a.id DESC LIMIT 6
      `, [organizationId]),
      this.dataSource.query<Row[]>(`
        SELECT n.id,n.body,n.created_at AS "createdAt",n.author_user_id AS "authorUserId",
          ${this.actorLabelSql("u")} AS "authorLabel",n.archived_at AS "archivedAt"
        FROM crm_notes n LEFT JOIN crm_contacts c ON c.id=n.contact_id LEFT JOIN crm_leads l ON l.id=n.lead_id
        LEFT JOIN crm_deals d ON d.id=n.deal_id LEFT JOIN users u ON u.id=n.author_user_id
        WHERE COALESCE(n.organization_id,c.organization_id,l.organization_id,d.organization_id)=$1 AND n.archived_at IS NULL
        ORDER BY n.created_at DESC,n.id DESC LIMIT 6
      `, [organizationId]),
    ]);
    const sectionErrors: string[] = [];
    const value = <T>(result: PromiseSettledResult<T>, section: string, fallback: T): T => {
      if (result.status === "fulfilled") return result.value;
      sectionErrors.push(section);
      return fallback;
    };
    const [counts, leads, deals, openTasks, recentActivities, recentNotes] = [
      value(reads[0], "summary", [] as Row[]), value(reads[1], "leads", [] as Row[]),
      value(reads[2], "deals", [] as Row[]), value(reads[3], "tasks", [] as Row[]),
      value(reads[4], "activities", [] as Row[]), value(reads[5], "notes", [] as Row[]),
    ];
    const tasks = openTasks;
    const totals = counts[0];
    return {
      summary: {
        contactCount: totals ? Number(totals.contactCount) : null,
        leadCount: totals ? Number(totals.leadCount) : null,
        dealCount: totals ? Number(totals.dealCount) : null,
        openDealCount: totals ? Number(totals.openDealCount) : null,
        openTaskCount: totals ? Number(totals.openTaskCount) : null,
        lastActivity: recentActivities[0] ? {
          id: recentActivities[0].id, activityType: recentActivities[0].activityType,
          subject: recentActivities[0].subject, outcome: recentActivities[0].outcome,
          occurredAt: recentActivities[0].occurredAt,
        } : null,
        nextTask: tasks[0] ?? null,
      },
      leads,
      deals,
      openTasks: tasks,
      recentActivities,
      recentNotes,
      sectionErrors,
    };
  }

  private actorLabelSql(alias: string) {
    return `CASE WHEN ${alias}.id IS NULL THEN NULL WHEN ${alias}.phone IS NOT NULL THEN 'اپراتور ·•••' || right(${alias}.phone,4) WHEN ${alias}.email IS NOT NULL THEN 'اپراتور ' || left(${alias}.email,1) || '…' ELSE 'اپراتور ' || left(${alias}.id::text,8) END`;
  }
}
