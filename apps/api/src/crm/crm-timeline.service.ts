import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CrmTimelineItem, CrmTimelineQueryDto } from "./dto/crm-timeline.dto";

type TimelineRow = Record<string, any>;

@Injectable()
export class CrmTimelineService {
  constructor(private readonly dataSource: DataSource) {}

  async list(organizationId: string, query: CrmTimelineQueryDto) {
    if (query.dateFrom && query.dateTo && new Date(query.dateFrom).getTime() > new Date(query.dateTo).getTime()) {
      throw new BadRequestException("Timeline date range is invalid");
    }
    const organizations = await this.dataSource.query<Array<{ id: string }>>(
      "SELECT id FROM crm_organizations WHERE id=$1", [organizationId],
    );
    if (!organizations[0]) throw new NotFoundException("CRM Organization not found");

    const rows = await this.dataSource.query<TimelineRow[]>(`
      WITH event_rows AS (
        ${this.eventsSql()}
      ), total AS (
        SELECT count(*)::int AS value FROM event_rows
      ), page AS (
        SELECT * FROM event_rows
        ORDER BY "occurredAt" DESC, category ASC, id ASC
        LIMIT $5 OFFSET $6
      )
      SELECT total.value AS total, page.*
      FROM total LEFT JOIN page ON TRUE
      ORDER BY page."occurredAt" DESC NULLS LAST, page.category ASC, page.id ASC
    `, [organizationId, query.category ?? null, query.dateFrom ?? null, query.dateTo ?? null, query.pageSize, (query.page - 1) * query.pageSize]);

    const items: CrmTimelineItem[] = rows.filter((row) => row.id !== null).map((row) => ({
      id: row.id,
      type: row.type,
      category: row.category,
      occurredAt: new Date(row.occurredAt).toISOString(),
      actor: {
        userId: row.actorUserId,
        label: row.actorLabel,
        kind: row.actorUserId ? "USER" : row.metadata?.source === "LANDING_FORM" ? "SYSTEM" : row.actorLabel ? "SYSTEM" : "UNKNOWN",
      },
      title: row.title,
      description: row.description,
      organizationId: row.organizationId,
      contactId: row.contactId,
      leadId: row.leadId,
      dealId: row.dealId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      metadata: row.metadata,
    }));
    return { items, total: Number(rows[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  private eventsSql() {
    const filter = (category: string) => `AND ($2::text IS NULL OR $2='${category}')
      AND ($3::timestamptz IS NULL OR event_time >= $3)
      AND ($4::timestamptz IS NULL OR event_time < $4)`;
    const actorLabel = (alias: string) => `CASE
      WHEN ${alias}.id IS NULL THEN NULL
      WHEN ${alias}.phone IS NOT NULL THEN 'اپراتور ·•••' || right(${alias}.phone,4)
      WHEN ${alias}.email IS NOT NULL THEN 'اپراتور ' || left(${alias}.email,1) || '…'
      ELSE 'اپراتور ' || left(${alias}.id::text,8) END`;
    return `
      SELECT 'lead-created:'||l.id AS id,'LEAD_CREATED' AS type,'LEAD' AS category,l.created_at AS "occurredAt",
        l.created_by_user_id AS "actorUserId",
        ${actorLabel("u")} AS "actorLabel",
        l.business_name AS title,NULL::text AS description,l.organization_id AS "organizationId",l.primary_contact_id AS "contactId",
        l.id AS "leadId",NULL::uuid AS "dealId",'LEAD' AS "sourceType",l.id::text AS "sourceId",
        jsonb_build_object('source',l.source,'status',l.status) AS metadata
      FROM crm_leads l LEFT JOIN users u ON u.id=l.created_by_user_id
      WHERE l.organization_id=$1 ${filter("LEAD").replaceAll("event_time", "l.created_at")}

      UNION ALL
      SELECT 'lead-status:'||h.id,CASE h.next_status WHEN 'QUALIFIED' THEN 'LEAD_QUALIFIED'
        WHEN 'UNQUALIFIED' THEN 'LEAD_UNQUALIFIED' WHEN 'CONVERTED' THEN 'LEAD_CONVERTED'
        ELSE 'LEAD_STATUS_CHANGED' END,'LEAD',h.created_at,h.changed_by_user_id,${actorLabel("u")},l.business_name,h.reason,
        l.organization_id,l.primary_contact_id,l.id,NULL::uuid,'LEAD_STATUS_HISTORY',h.id::text,
        jsonb_build_object('previousStatus',h.previous_status,'nextStatus',h.next_status,'reason',h.reason)
      FROM crm_lead_status_history h JOIN crm_leads l ON l.id=h.lead_id
      LEFT JOIN users u ON u.id=h.changed_by_user_id
      WHERE l.organization_id=$1 AND h.previous_status IS NOT NULL ${filter("LEAD").replaceAll("event_time", "h.created_at")}
        AND h.next_status IN ('NEW','ATTEMPTING_CONTACT','CONTACTED','QUALIFIED','NURTURING','UNQUALIFIED','CONVERTED')
      
      UNION ALL
      SELECT 'deal-created:'||d.id,'DEAL_CREATED','DEAL',d.created_at,d.created_by_user_id,${actorLabel("u")},d.title,NULL::text,
        d.organization_id,d.primary_contact_id,d.originating_lead_id,d.id,'DEAL',d.id::text,
        '{}'::jsonb
      FROM crm_deals d LEFT JOIN users u ON u.id=d.created_by_user_id
      WHERE d.organization_id=$1 ${filter("DEAL").replaceAll("event_time", "d.created_at")}

      UNION ALL
      SELECT 'deal-stage:'||h.id,'DEAL_STAGE_CHANGED','DEAL',h.created_at,h.changed_by_user_id,${actorLabel("u")},d.title,h.reason,
        d.organization_id,d.primary_contact_id,d.originating_lead_id,d.id,'DEAL_STAGE_HISTORY',h.id::text,
        jsonb_build_object('fromStage',h.from_stage,'toStage',h.to_stage,'reason',h.reason)
      FROM crm_deal_stage_history h JOIN crm_deals d ON d.id=h.deal_id
      LEFT JOIN users u ON u.id=h.changed_by_user_id
      WHERE d.organization_id=$1 AND h.from_stage IS NOT NULL ${filter("DEAL").replaceAll("event_time", "h.created_at")}

      UNION ALL
      SELECT 'deal-outcome:'||d.id,CASE WHEN d.status='WON' THEN 'DEAL_WON' ELSE 'DEAL_LOST' END,'DEAL',
        CASE WHEN d.status='WON' THEN d.won_at ELSE d.lost_at END,e.actor_user_id,${actorLabel("u")},d.title,NULL::text,
        d.organization_id,d.primary_contact_id,d.originating_lead_id,d.id,'DEAL_OUTCOME',d.id::text,
        jsonb_build_object('stage',d.stage,'lossReason',d.loss_reason)
      FROM crm_deals d
      LEFT JOIN LATERAL (
        SELECT actor_user_id FROM platform_audit_events
        WHERE target_type='crm_deal' AND target_id=d.id::text
          AND action=CASE WHEN d.status='WON' THEN 'crm.deal.won' ELSE 'crm.deal.lost' END
        ORDER BY created_at DESC,id DESC LIMIT 1
      ) e ON TRUE
      LEFT JOIN users u ON u.id=e.actor_user_id
      WHERE d.organization_id=$1 AND d.status IN ('WON','LOST') ${filter("DEAL").replaceAll("event_time", "CASE WHEN d.status='WON' THEN d.won_at ELSE d.lost_at END")}

      UNION ALL
      SELECT 'activity:'||a.id,'ACTIVITY_LOGGED','ACTIVITY',a.occurred_at,a.actor_user_id,${actorLabel("u")},a.subject,a.details,
        COALESCE(a.organization_id,c.organization_id,l.organization_id,d.organization_id),a.contact_id,a.lead_id,a.deal_id,
        'ACTIVITY',a.id::text,jsonb_build_object('activityType',a.activity_type,'outcome',a.outcome,'contactName',c.name)
      FROM crm_activities a LEFT JOIN crm_contacts c ON c.id=a.contact_id
      LEFT JOIN crm_leads l ON l.id=a.lead_id LEFT JOIN crm_deals d ON d.id=a.deal_id
      LEFT JOIN users u ON u.id=a.actor_user_id
      WHERE COALESCE(a.organization_id,c.organization_id,l.organization_id,d.organization_id)=$1 ${filter("ACTIVITY").replaceAll("event_time", "a.occurred_at")}

      UNION ALL
      SELECT 'task-created:'||t.id,'TASK_CREATED','TASK',t.created_at,t.created_by_user_id,${actorLabel("u")},t.title,t.description,
        COALESCE(t.organization_id,c.organization_id,l.organization_id,d.organization_id),t.contact_id,t.lead_id,t.deal_id,
        'TASK',t.id::text,jsonb_build_object('taskId',t.id,'kind',t.kind,'priority',t.priority,'dueAt',t.due_at)
      FROM crm_tasks t LEFT JOIN crm_contacts c ON c.id=t.contact_id
      LEFT JOIN crm_leads l ON l.id=t.lead_id LEFT JOIN crm_deals d ON d.id=t.deal_id
      LEFT JOIN users u ON u.id=t.created_by_user_id
      WHERE COALESCE(t.organization_id,c.organization_id,l.organization_id,d.organization_id)=$1 ${filter("TASK").replaceAll("event_time", "t.created_at")}

      UNION ALL
      SELECT 'task-lifecycle:'||e.id,CASE e.action WHEN 'crm.task.completed' THEN 'TASK_COMPLETED'
        WHEN 'crm.task.canceled' THEN 'TASK_CANCELED' ELSE 'TASK_REOPENED' END,'TASK',e.created_at,e.actor_user_id,
        ${actorLabel("u")},t.title,NULL::text,COALESCE(t.organization_id,c.organization_id,l.organization_id,d.organization_id),
        t.contact_id,t.lead_id,t.deal_id,'TASK_LIFECYCLE',e.id::text,
        jsonb_build_object('taskId',t.id,'previousStatus',e.summary->>'previousStatus','status',e.summary->>'status')
      FROM platform_audit_events e JOIN crm_tasks t ON t.id::text=e.target_id
      LEFT JOIN crm_contacts c ON c.id=t.contact_id LEFT JOIN crm_leads l ON l.id=t.lead_id
      LEFT JOIN crm_deals d ON d.id=t.deal_id LEFT JOIN users u ON u.id=e.actor_user_id
      WHERE e.target_type='crm_task' AND e.action IN ('crm.task.completed','crm.task.canceled','crm.task.reopened')
        AND COALESCE(t.organization_id,c.organization_id,l.organization_id,d.organization_id)=$1 ${filter("TASK").replaceAll("event_time", "e.created_at")}

      UNION ALL
      SELECT 'note:'||n.id,'NOTE_ADDED','NOTE',n.created_at,n.author_user_id,${actorLabel("u")},'NOTE'::text,n.body,
        COALESCE(n.organization_id,c.organization_id,l.organization_id,d.organization_id),n.contact_id,n.lead_id,n.deal_id,
        'NOTE',n.id::text,jsonb_build_object('updatedAt',n.updated_at)
      FROM crm_notes n LEFT JOIN crm_contacts c ON c.id=n.contact_id
      LEFT JOIN crm_leads l ON l.id=n.lead_id LEFT JOIN crm_deals d ON d.id=n.deal_id
      LEFT JOIN users u ON u.id=n.author_user_id
      WHERE COALESCE(n.organization_id,c.organization_id,l.organization_id,d.organization_id)=$1 ${filter("NOTE").replaceAll("event_time", "n.created_at")}

      UNION ALL
      SELECT 'tenant-created:'||s.id,'TENANT_CREATED','CUSTOMER',s.created_at,NULL::uuid,NULL::text,s.name,NULL::text,
        o.id,NULL::uuid,NULL::uuid,NULL::uuid,'TENANT',s.id::text,jsonb_build_object('tenantId',s.id)
      FROM crm_organizations o JOIN coffee_shops s ON s.id=o.coffee_shop_id OR EXISTS (
        SELECT 1 FROM platform_audit_events history WHERE history.target_type='crm_organization' AND history.target_id=o.id::text
          AND history.action IN ('crm.organization.tenant_linked','crm.organization.tenant_unlinked')
          AND history.summary->>'coffeeShopId'=s.id::text
      )
      WHERE o.id=$1 ${filter("CUSTOMER").replaceAll("event_time", "s.created_at")}

      UNION ALL
      SELECT 'tenant-link:'||e.id,CASE e.action WHEN 'crm.organization.tenant_linked' THEN 'TENANT_LINKED' ELSE 'TENANT_UNLINKED' END,
        'CUSTOMER',e.created_at,e.actor_user_id,${actorLabel("u")},
        CASE e.action WHEN 'crm.organization.tenant_linked' THEN 'Tenant linked' ELSE 'Tenant unlinked' END,NULL::text,
        $1::uuid,NULL::uuid,NULL::uuid,NULL::uuid,'TENANT_LINK',e.id::text,
        jsonb_build_object('tenantId',e.summary->>'coffeeShopId')
      FROM platform_audit_events e LEFT JOIN users u ON u.id=e.actor_user_id
      WHERE e.target_type='crm_organization' AND e.target_id=$1::text
        AND e.action IN ('crm.organization.tenant_linked','crm.organization.tenant_unlinked') ${filter("CUSTOMER").replaceAll("event_time", "e.created_at")}

      UNION ALL
      SELECT 'trial-started:'||s.id,'TRIAL_STARTED','CUSTOMER',s.trial_started_at,NULL::uuid,NULL::text,'Trial started',NULL::text,
        o.id,NULL::uuid,NULL::uuid,NULL::uuid,'TRIAL',s.id::text,jsonb_build_object('endsAt',s.trial_ends_at)
      FROM crm_organizations o JOIN subscriptions s ON s.coffee_shop_id=o.coffee_shop_id OR EXISTS (
        SELECT 1 FROM platform_audit_events history WHERE history.target_type='crm_organization' AND history.target_id=o.id::text
          AND history.action IN ('crm.organization.tenant_linked','crm.organization.tenant_unlinked')
          AND history.summary->>'coffeeShopId'=s.coffee_shop_id::text
      )
      WHERE o.id=$1 AND s.trial_started_at IS NOT NULL ${filter("CUSTOMER").replaceAll("event_time", "s.trial_started_at")}

      UNION ALL
      SELECT 'subscription-payment:'||p.id,
        CASE p.operation WHEN 'RENEWAL' THEN 'SUBSCRIPTION_RENEWED' WHEN 'REACTIVATION' THEN 'SUBSCRIPTION_REACTIVATED'
          WHEN 'UPGRADE' THEN 'SUBSCRIPTION_PLAN_CHANGED' ELSE 'SUBSCRIPTION_ACTIVATED' END,
        'CUSTOMER',p.paid_at,p.recorded_by_user_id,${actorLabel("u")},p.plan_name_snapshot,NULL::text,
        o.id,NULL::uuid,NULL::uuid,NULL::uuid,'SUBSCRIPTION_PAYMENT',p.id::text,
        jsonb_build_object('operation',p.operation,'periodEndsAt',p.period_ends_at)
      FROM crm_organizations o JOIN subscriptions s ON s.coffee_shop_id=o.coffee_shop_id OR EXISTS (
        SELECT 1 FROM platform_audit_events history WHERE history.target_type='crm_organization' AND history.target_id=o.id::text
          AND history.action IN ('crm.organization.tenant_linked','crm.organization.tenant_unlinked')
          AND history.summary->>'coffeeShopId'=s.coffee_shop_id::text
      )
      JOIN subscription_payments p ON p.subscription_id=s.id LEFT JOIN users u ON u.id=p.recorded_by_user_id
      WHERE o.id=$1 AND p.status='PAID' AND p.operation IN ('PURCHASE','TRIAL_TO_PAID','RENEWAL','REACTIVATION','UPGRADE')
        ${filter("CUSTOMER").replaceAll("event_time", "p.paid_at")}
    `;
  }
}
