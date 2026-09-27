import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { escapeLike } from "./crm-normalization.util";
import { CrmActivityType } from "./entities/crm-activity.entity";
import { CrmActivityListQueryDto, CreateCrmActivityDto, UpdateCrmActivityDto } from "./dto/crm-work.dto";
import { resolveCrmWorkLinks } from "./crm-work-relations.util";
import { isValidCrmActivityOutcome } from "./crm-work-lifecycle.util";
import { CrmScoringService } from "./crm-scoring.service";
import { CrmWorkflowEventService } from "./crm-workflow-event.service";

type Row = Record<string, any>;

@Injectable()
export class CrmActivityService {
  constructor(private readonly dataSource: DataSource, @Optional() private readonly scoring?: CrmScoringService, @Optional() private readonly workflowEvents?: CrmWorkflowEventService) {}

  async list(query: CrmActivityListQueryDto) {
    this.assertRange(query.occurredFrom, query.occurredTo);
    const where: string[] = [];
    const values: unknown[] = [];
    this.addFilters(where, values, query);
    const predicate = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const counts = await this.dataSource.query<Array<{ total: string }>>(`SELECT count(*)::text AS total ${this.fromSql()} ${predicate}`, values);
    const sort = query.sort === "createdAt" ? "a.created_at" : "a.occurred_at";
    const pageValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
    const items = await this.dataSource.query<Row[]>(`SELECT ${this.columnsSql()} ${this.fromSql()} ${predicate}
      ORDER BY ${sort} ${query.direction},a.id DESC LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`, pageValues);
    return { items, total: Number(counts[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async get(id: string) { return this.detail(this.dataSource, id); }

  async create(input: CreateCrmActivityDto, actorId: string) {
    const occurredAt = this.validOccurredAt(input.occurredAt);
    this.assertOutcome(input.activityType, input.outcome ?? null);
    return this.dataSource.transaction(async (manager) => {
      const links = await resolveCrmWorkLinks(manager, input);
      const rows = await manager.query<Row[]>(`INSERT INTO crm_activities
        (organization_id,contact_id,lead_id,deal_id,activity_type,subject,details,occurred_at,outcome,actor_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`, [
        links.organizationId, links.contactId, links.leadId, links.dealId,
        input.activityType, input.subject.trim(), this.optionalText(input.details), occurredAt, input.outcome ?? null, actorId,
      ]);
      const id = rows[0]!.id as string;
      await this.audit(manager, actorId, "crm.activity.created", id, { type: input.activityType, outcome: input.outcome ?? null });
      await this.recalculateActivityLinks(manager, [{ leadId: links.leadId, organizationId: links.organizationId }]);
      await this.workflowEvents?.record(manager, { eventType: "ACTIVITY_CREATED", subjectType: "ACTIVITY", subjectId: id, eventContext: { activityType: input.activityType, outcome: input.outcome ?? null } });
      return this.detail(manager, id);
    });
  }

  async update(id: string, input: UpdateCrmActivityDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const activity = await this.findActivity(manager, id, true);
      if (!activity) throw new NotFoundException("CRM Activity not found");
      this.assertEditable(activity);
      const activityType = (input.activityType ?? activity.activity_type) as CrmActivityType;
      const outcome = input.outcome === undefined ? activity.outcome : input.outcome;
      this.assertOutcome(activityType, outcome);
      const occurredAt = this.validOccurredAt(input.occurredAt ?? activity.occurred_at);
      const links = await resolveCrmWorkLinks(manager, {
        organizationId: input.organizationId === undefined ? activity.organization_id : input.organizationId,
        contactId: input.contactId === undefined ? activity.contact_id : input.contactId,
        leadId: input.leadId === undefined ? activity.lead_id : input.leadId,
        dealId: input.dealId === undefined ? activity.deal_id : input.dealId,
      });
      await manager.query(`UPDATE crm_activities SET organization_id=$2,contact_id=$3,lead_id=$4,deal_id=$5,
        activity_type=$6,subject=$7,details=$8,occurred_at=$9,outcome=$10,updated_by_user_id=$11,updated_at=now() WHERE id=$1`, [
        id, links.organizationId, links.contactId, links.leadId, links.dealId, activityType,
        input.subject === undefined ? activity.subject : input.subject.trim(),
        input.details === undefined ? activity.details : this.optionalText(input.details), occurredAt, outcome ?? null, actorId,
      ]);
      await this.audit(manager, actorId, "crm.activity.updated", id, { type: activityType, outcome: outcome ?? null });
      await this.recalculateActivityLinks(manager, [
        { leadId: activity.lead_id, organizationId: activity.organization_id },
        { leadId: links.leadId, organizationId: links.organizationId },
      ]);
      return this.detail(manager, id);
    });
  }

  async archive(id: string, actorId: string) { return this.setArchived(id, actorId, true); }
  async restore(id: string, actorId: string) { return this.setArchived(id, actorId, false); }

  private async setArchived(id: string, actorId: string, archive: boolean) {
    return this.dataSource.transaction(async (manager) => {
      const activity = await this.findActivity(manager, id, true);
      if (!activity) throw new NotFoundException("CRM Activity not found");
      if (Boolean(activity.archived_at) === archive) return this.project(activity);
      await manager.query("UPDATE crm_activities SET archived_at=$2,archived_by_user_id=$3,updated_by_user_id=$3,updated_at=now() WHERE id=$1", [id, archive ? new Date() : null, archive ? actorId : null]);
      await this.audit(manager, actorId, archive ? "crm.activity.archived" : "crm.activity.restored", id);
      await this.recalculateActivityLinks(manager, [{ leadId: activity.lead_id, organizationId: activity.organization_id }]);
      return this.detail(manager, id);
    });
  }

  private async detail(manager: DataSource | EntityManager, id: string) {
    const row = await this.findActivity(manager, id);
    if (!row) throw new NotFoundException("CRM Activity not found");
    return this.project(row);
  }

  private async recalculateActivityLinks(manager: EntityManager, links: { leadId: string | null; organizationId: string | null }[]) {
    const leadIds = new Set<string>();
    for (const link of links) {
      if (link.leadId) leadIds.add(link.leadId);
      else if (link.organizationId) {
        const rows = await manager.query<Row[]>("SELECT id FROM crm_leads WHERE organization_id=$1 AND archived_at IS NULL AND status<>'CONVERTED' ORDER BY id LIMIT 5001", [link.organizationId]);
        if (rows.length > 5000) throw new ConflictException("Too many Leads for activity score recalculation; use a background batch worker.");
        for (const row of rows) leadIds.add(row.id as string);
      }
    }
    await this.scoring?.recalculateLeadIds([...leadIds], "ACTIVITY_CHANGED", manager);
  }

  private async findActivity(manager: DataSource | EntityManager, id: string, lock = false): Promise<Row | null> {
    const rows = await manager.query<Row[]>(`SELECT a.*,COALESCE(a.organization_id,l.organization_id) AS effective_organization_id,
      o.name AS organization_name,c.name AS contact_name,c.role AS contact_role,
      l.business_name AS lead_name,d.title AS deal_title,
      ${this.actorLabelSql("u")} AS actor_label
      ${this.fromSql()} WHERE a.id=$1 ${lock ? "FOR UPDATE OF a" : ""}`, [id]);
    return rows[0] ?? null;
  }

  private fromSql() {
    return `FROM crm_activities a
      LEFT JOIN crm_organizations o ON o.id=COALESCE(a.organization_id,(SELECT l.organization_id FROM crm_leads l WHERE l.id=a.lead_id))
      LEFT JOIN crm_contacts c ON c.id=a.contact_id
      LEFT JOIN crm_leads l ON l.id=a.lead_id
      LEFT JOIN crm_deals d ON d.id=a.deal_id
      LEFT JOIN users u ON u.id=a.actor_user_id`;
  }

  private columnsSql() {
    return `a.id,COALESCE(a.organization_id,l.organization_id) AS "organizationId",o.name AS "organizationName",a.contact_id AS "contactId",c.name AS "contactName",c.role AS "contactRole",
      a.lead_id AS "leadId",l.business_name AS "leadName",a.deal_id AS "dealId",d.title AS "dealTitle",
      a.activity_type AS "activityType",a.subject,a.details,a.occurred_at AS "occurredAt",a.outcome,a.actor_user_id AS "actorUserId",
      ${this.actorLabelSql("u")} AS "actorLabel",a.updated_by_user_id AS "updatedByUserId",a.archived_at AS "archivedAt",a.created_at AS "createdAt",a.updated_at AS "updatedAt"`;
  }

  private project(row: Row) {
    return {
      id: row.id, organizationId: row.effective_organization_id ?? row.organizationId ?? row.organization_id ?? null,
      organizationName: row.organization_name ?? row.organizationName ?? null,
      contactId: row.contact_id ?? row.contactId ?? null, contactName: row.contact_name ?? row.contactName ?? null, contactRole: row.contact_role ?? row.contactRole ?? null,
      leadId: row.lead_id ?? row.leadId ?? null, leadName: row.lead_name ?? row.leadName ?? null,
      dealId: row.deal_id ?? row.dealId ?? null, dealTitle: row.deal_title ?? row.dealTitle ?? null,
      activityType: row.activity_type ?? row.activityType, subject: row.subject, details: row.details,
      occurredAt: row.occurred_at ?? row.occurredAt, outcome: row.outcome,
      actorUserId: row.actor_user_id ?? row.actorUserId ?? null, actorLabel: row.actor_label ?? row.actorLabel ?? null,
      updatedByUserId: row.updated_by_user_id ?? row.updatedByUserId ?? null,
      archivedAt: row.archived_at ?? row.archivedAt ?? null, createdAt: row.created_at ?? row.createdAt, updatedAt: row.updated_at ?? row.updatedAt,
    };
  }

  private addFilters(where: string[], values: unknown[], query: CrmActivityListQueryDto) {
    if (query.archiveStatus === "ACTIVE") where.push("a.archived_at IS NULL");
    else if (query.archiveStatus === "ARCHIVED") where.push("a.archived_at IS NOT NULL");
    const filters: [keyof CrmActivityListQueryDto, string][] = [
      ["activityType", "a.activity_type"], ["outcome", "a.outcome"], ["actorUserId", "a.actor_user_id"],
      ["organizationId", "COALESCE(a.organization_id,l.organization_id)"], ["contactId", "a.contact_id"], ["leadId", "a.lead_id"], ["dealId", "a.deal_id"],
    ];
    for (const [key, column] of filters) {
      const value = query[key];
      if (value) { values.push(value); where.push(`${column}=$${values.length}`); }
    }
    if (query.occurredFrom) { values.push(query.occurredFrom); where.push(`a.occurred_at >= $${values.length}`); }
    if (query.occurredTo) { values.push(query.occurredTo); where.push(`a.occurred_at < $${values.length}`); }
    if (query.q) {
      values.push(`%${escapeLike(query.q)}%`);
      where.push(`(a.subject ILIKE $${values.length} ESCAPE '!' OR COALESCE(a.details,'') ILIKE $${values.length} ESCAPE '!' OR COALESCE(o.name,'') ILIKE $${values.length} ESCAPE '!' OR COALESCE(c.name,'') ILIKE $${values.length} ESCAPE '!' OR COALESCE(l.business_name,'') ILIKE $${values.length} ESCAPE '!' OR COALESCE(d.title,'') ILIKE $${values.length} ESCAPE '!')`);
    }
  }

  private assertOutcome(type: CrmActivityType, outcome: string | null | undefined) {
    if (!isValidCrmActivityOutcome(type, outcome)) throw new BadRequestException("The selected outcome is not valid for this Activity type");
  }

  private validOccurredAt(value: string | Date) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException("Activity time must be a valid timestamp");
    if (date.getTime() > Date.now()) throw new BadRequestException("Activities must describe an interaction that has already happened");
    return date;
  }

  private assertRange(from?: string, to?: string) {
    if (from && to && new Date(from).getTime() >= new Date(to).getTime()) throw new BadRequestException("Activity date range is invalid");
  }

  private optionalText(value: string | null | undefined) { return value?.trim() || null; }

  private actorLabelSql(alias: string) {
    return `CASE WHEN ${alias}.id IS NULL THEN NULL WHEN ${alias}.phone IS NOT NULL THEN 'اپراتور ·•••' || right(${alias}.phone,4) WHEN ${alias}.email IS NOT NULL THEN 'اپراتور ' || left(${alias}.email,1) || '…' ELSE 'اپراتور ' || left(${alias}.id::text,8) END`;
  }

  private async audit(manager: EntityManager, actorId: string, action: string, id: string, summary: Record<string, string | null> = {}) {
    await manager.query("INSERT INTO platform_audit_events (actor_user_id,action,target_type,target_id,summary) VALUES ($1,$2,'crm_activity',$3,$4::jsonb)", [actorId, action, id, JSON.stringify(summary)]);
  }

  private assertEditable(row: Row) { if (row.archived_at) throw new ConflictException("Restore this Activity before editing it"); }
}
