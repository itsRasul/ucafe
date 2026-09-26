import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { CrmLeadService } from "./crm-lead.service";
import { escapeLike } from "./crm-normalization.util";
import { CrmTaskKind, CrmTaskPriority, CrmTaskStatus } from "./entities/crm-task.entity";
import { CrmTaskListQueryDto, CreateCrmTaskDto, UpdateCrmTaskDto } from "./dto/crm-work.dto";
import { resolveCrmWorkLinks } from "./crm-work-relations.util";

type Row = Record<string, any>;

@Injectable()
export class CrmTaskService {
  constructor(private readonly dataSource: DataSource, private readonly leads: CrmLeadService) {}

  async list(query: CrmTaskListQueryDto, actorId: string) {
    this.assertRange(query.dueFrom, query.dueTo);
    const where: string[] = [];
    const values: unknown[] = [];
    this.addFilters(where, values, query, actorId);
    const predicate = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const from = this.fromSql();
    const counts = await this.dataSource.query<Array<{ total: string }>>(`SELECT count(*)::text AS total ${from} ${predicate}`, values);
    const sort = {
      dueAt: "t.due_at",
      priority: "CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END",
      createdAt: "t.created_at",
      updatedAt: "t.updated_at",
    }[query.sort];
    const nullsLast = query.sort === "dueAt" ? " NULLS LAST" : "";
    const pageValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
    const items = await this.dataSource.query<Row[]>(`SELECT ${this.columnsSql()} ${from} ${predicate}
      ORDER BY ${sort} ${query.direction}${nullsLast},t.id ASC LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`, pageValues);
    return { items, total: Number(counts[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async get(id: string) { return this.detail(this.dataSource, id); }

  async create(input: CreateCrmTaskDto, actorId: string) {
    const title = this.requireText(input.title);
    const dueAt = this.validDueAt(input.dueAt);
    const assigneeId = input.assignedToUserId ?? null;
    return this.dataSource.transaction(async (manager) => {
      const links = await resolveCrmWorkLinks(manager, input);
      await this.leads.assertCrmAssignee(manager, assigneeId);
      const rows = await manager.query<Row[]>(`INSERT INTO crm_tasks
        (organization_id,contact_id,lead_id,deal_id,title,description,kind,status,priority,due_at,assigned_to_user_id,created_by_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9,$10,$11,$11) RETURNING id`, [
        links.organizationId, links.contactId, links.leadId, links.dealId, title, this.optionalText(input.description),
        input.kind ?? CrmTaskKind.General, input.priority ?? CrmTaskPriority.Normal, dueAt, assigneeId, actorId,
      ]);
      const id = rows[0]!.id as string;
      await this.audit(manager, actorId, "crm.task.created", id, { status: CrmTaskStatus.Open, kind: input.kind ?? CrmTaskKind.General, priority: input.priority ?? CrmTaskPriority.Normal });
      return this.detail(manager, id);
    });
  }

  async update(id: string, input: UpdateCrmTaskDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const task = await this.findTask(manager, id, true);
      if (!task) throw new NotFoundException("CRM Task not found");
      this.assertEditable(task);
      if (task.status !== CrmTaskStatus.Open) throw new ConflictException("Only open Tasks can be edited");
      const assignedToUserId = input.assignedToUserId === undefined ? task.assigned_to_user_id : input.assignedToUserId;
      if (input.assignedToUserId !== undefined) await this.leads.assertCrmAssignee(manager, assignedToUserId);
      const links = await resolveCrmWorkLinks(manager, {
        organizationId: input.organizationId === undefined ? task.organization_id : input.organizationId,
        contactId: input.contactId === undefined ? task.contact_id : input.contactId,
        leadId: input.leadId === undefined ? task.lead_id : input.leadId,
        dealId: input.dealId === undefined ? task.deal_id : input.dealId,
      });
      const title = input.title === undefined ? task.title : this.requireText(input.title);
      const description = input.description === undefined ? task.description : this.optionalText(input.description);
      const kind = input.kind ?? task.kind;
      const priority = input.priority ?? task.priority;
      const dueAt = input.dueAt === undefined ? task.due_at : this.validDueAt(input.dueAt);
      await manager.query(`UPDATE crm_tasks SET organization_id=$2,contact_id=$3,lead_id=$4,deal_id=$5,title=$6,description=$7,
        kind=$8,priority=$9,due_at=$10,assigned_to_user_id=$11,updated_by_user_id=$12,updated_at=now() WHERE id=$1`, [
        id, links.organizationId, links.contactId, links.leadId, links.dealId, title, description, kind, priority, dueAt, assignedToUserId, actorId,
      ]);
      await this.audit(manager, actorId, "crm.task.updated", id, { status: task.status, priority, assignedToUserId });
      return this.detail(manager, id);
    });
  }

  async complete(id: string, actorId: string) { return this.transition(id, actorId, CrmTaskStatus.Completed); }
  async cancel(id: string, actorId: string) { return this.transition(id, actorId, CrmTaskStatus.Canceled); }
  async reopen(id: string, actorId: string) { return this.transition(id, actorId, CrmTaskStatus.Open); }
  async archive(id: string, actorId: string) { return this.setArchived(id, actorId, true); }
  async restore(id: string, actorId: string) { return this.setArchived(id, actorId, false); }

  private async transition(id: string, actorId: string, target: CrmTaskStatus) {
    return this.dataSource.transaction(async (manager) => {
      const task = await this.findTask(manager, id, true);
      if (!task) throw new NotFoundException("CRM Task not found");
      this.assertEditable(task);
      const current = task.status as CrmTaskStatus;
      if (current === target || (target !== CrmTaskStatus.Open && current !== CrmTaskStatus.Open) || (target === CrmTaskStatus.Open && current === CrmTaskStatus.Open)) {
        throw new ConflictException("Task status changed; refresh and try again");
      }
      if (target === CrmTaskStatus.Completed) {
        await manager.query("UPDATE crm_tasks SET status='COMPLETED',completed_at=now(),completed_by_user_id=$2,canceled_at=NULL,canceled_by_user_id=NULL,updated_by_user_id=$2,updated_at=now() WHERE id=$1", [id, actorId]);
      } else if (target === CrmTaskStatus.Canceled) {
        await manager.query("UPDATE crm_tasks SET status='CANCELED',canceled_at=now(),canceled_by_user_id=$2,completed_at=NULL,completed_by_user_id=NULL,updated_by_user_id=$2,updated_at=now() WHERE id=$1", [id, actorId]);
      } else {
        await manager.query("UPDATE crm_tasks SET status='OPEN',completed_at=NULL,completed_by_user_id=NULL,canceled_at=NULL,canceled_by_user_id=NULL,updated_by_user_id=$2,updated_at=now() WHERE id=$1", [id, actorId]);
      }
      const action = target === CrmTaskStatus.Open ? "crm.task.reopened" : target === CrmTaskStatus.Completed ? "crm.task.completed" : "crm.task.canceled";
      await this.audit(manager, actorId, action, id, { previousStatus: current, status: target });
      return this.detail(manager, id);
    });
  }

  private async setArchived(id: string, actorId: string, archive: boolean) {
    return this.dataSource.transaction(async (manager) => {
      const task = await this.findTask(manager, id, true);
      if (!task) throw new NotFoundException("CRM Task not found");
      if (Boolean(task.archived_at) === archive) return this.project(task);
      if (archive) this.assertEditable(task);
      if (archive && task.status === CrmTaskStatus.Open) throw new ConflictException("Complete or cancel an open Task before archiving it");
      await manager.query("UPDATE crm_tasks SET archived_at=$2,archived_by_user_id=$3,updated_by_user_id=$4,updated_at=now() WHERE id=$1", [id, archive ? new Date() : null, archive ? actorId : null, actorId]);
      await this.audit(manager, actorId, archive ? "crm.task.archived" : "crm.task.restored", id, { status: task.status });
      return this.detail(manager, id);
    });
  }

  private async detail(manager: DataSource | EntityManager, id: string) {
    const task = await this.findTask(manager, id);
    if (!task) throw new NotFoundException("CRM Task not found");
    return this.project(task);
  }

  private async findTask(manager: DataSource | EntityManager, id: string, lock = false): Promise<Row | null> {
    const rows = await manager.query<Row[]>(`SELECT t.*,COALESCE(t.organization_id,l.organization_id) AS effective_organization_id,
      o.name AS organization_name,c.name AS contact_name,c.role AS contact_role,l.business_name AS lead_name,d.title AS deal_title,
      ${this.actorLabelSql("u")} AS assignee_label
      ${this.fromSql()} WHERE t.id=$1 ${lock ? "FOR UPDATE OF t" : ""}`, [id]);
    return rows[0] ?? null;
  }

  private fromSql() {
    return `FROM crm_tasks t
      LEFT JOIN crm_leads l ON l.id=t.lead_id
      LEFT JOIN crm_organizations o ON o.id=COALESCE(t.organization_id,l.organization_id)
      LEFT JOIN crm_contacts c ON c.id=t.contact_id
      LEFT JOIN crm_deals d ON d.id=t.deal_id
      LEFT JOIN users u ON u.id=t.assigned_to_user_id`;
  }

  private columnsSql() {
    return `t.id,COALESCE(t.organization_id,l.organization_id) AS "organizationId",o.name AS "organizationName",
      t.contact_id AS "contactId",c.name AS "contactName",c.role AS "contactRole",t.lead_id AS "leadId",l.business_name AS "leadName",
      t.deal_id AS "dealId",d.title AS "dealTitle",t.title,t.description,t.kind,t.status,t.priority,t.due_at AS "dueAt",
      t.assigned_to_user_id AS "assignedToUserId",${this.actorLabelSql("u")} AS "assigneeLabel",t.completed_at AS "completedAt",
      t.completed_by_user_id AS "completedByUserId",t.canceled_at AS "canceledAt",t.canceled_by_user_id AS "canceledByUserId",
      t.created_by_user_id AS "createdByUserId",t.updated_by_user_id AS "updatedByUserId",t.archived_at AS "archivedAt",
      t.created_at AS "createdAt",t.updated_at AS "updatedAt",(t.status='OPEN' AND t.due_at < now()) AS overdue`;
  }

  private project(row: Row) {
    return {
      id: row.id, organizationId: row.effective_organization_id ?? row.organizationId ?? row.organization_id ?? null,
      organizationName: row.organization_name ?? row.organizationName ?? null,
      contactId: row.contact_id ?? row.contactId ?? null, contactName: row.contact_name ?? row.contactName ?? null, contactRole: row.contact_role ?? row.contactRole ?? null,
      leadId: row.lead_id ?? row.leadId ?? null, leadName: row.lead_name ?? row.leadName ?? null,
      dealId: row.deal_id ?? row.dealId ?? null, dealTitle: row.deal_title ?? row.dealTitle ?? null,
      title: row.title, description: row.description, kind: row.kind, status: row.status, priority: row.priority,
      dueAt: row.due_at ?? row.dueAt ?? null, assignedToUserId: row.assigned_to_user_id ?? row.assignedToUserId ?? null,
      assigneeLabel: row.assignee_label ?? row.assigneeLabel ?? null,
      completedAt: row.completed_at ?? row.completedAt ?? null, completedByUserId: row.completed_by_user_id ?? row.completedByUserId ?? null,
      canceledAt: row.canceled_at ?? row.canceledAt ?? null, canceledByUserId: row.canceled_by_user_id ?? row.canceledByUserId ?? null,
      createdByUserId: row.created_by_user_id ?? row.createdByUserId ?? null, updatedByUserId: row.updated_by_user_id ?? row.updatedByUserId ?? null,
      archivedAt: row.archived_at ?? row.archivedAt ?? null, createdAt: row.created_at ?? row.createdAt, updatedAt: row.updated_at ?? row.updatedAt,
      overdue: row.overdue ?? (row.status === CrmTaskStatus.Open && row.due_at !== null && new Date(row.due_at).getTime() < Date.now()),
    };
  }

  private addFilters(where: string[], values: unknown[], query: CrmTaskListQueryDto, actorId: string) {
    if (query.archiveStatus === "ACTIVE") where.push("t.archived_at IS NULL");
    else if (query.archiveStatus === "ARCHIVED") where.push("t.archived_at IS NOT NULL");
    if (query.status) { values.push(query.status); where.push(`t.status=$${values.length}`); }
    if (query.priority) { values.push(query.priority); where.push(`t.priority=$${values.length}`); }
    if (query.kind) { values.push(query.kind); where.push(`t.kind=$${values.length}`); }
    if (query.assigneeId === "UNASSIGNED") where.push("t.assigned_to_user_id IS NULL");
    else if (query.assigneeId) { values.push(query.assigneeId === "ME" ? actorId : query.assigneeId); where.push(`t.assigned_to_user_id=$${values.length}`); }
    if (query.organizationId) { values.push(query.organizationId); where.push(`COALESCE(t.organization_id,l.organization_id)=$${values.length}`); }
    for (const [key, column] of [["contactId", "t.contact_id"], ["leadId", "t.lead_id"], ["dealId", "t.deal_id"]] as const) {
      const value = query[key];
      if (value) { values.push(value); where.push(`${column}=$${values.length}`); }
    }
    if (query.view === "OPEN" || query.view === "NO_DUE_DATE") where.push("t.status='OPEN'");
    if (query.view === "OVERDUE") where.push("t.status='OPEN' AND t.due_at IS NOT NULL AND t.due_at < now()");
    if (query.view === "UPCOMING") where.push("t.status='OPEN' AND t.due_at > now()");
    if (query.view === "COMPLETED") where.push("t.status='COMPLETED'");
    if (query.view === "CANCELED") where.push("t.status='CANCELED'");
    if (query.view === "NO_DUE_DATE") where.push("t.due_at IS NULL");
    if (query.dueFrom) { values.push(query.dueFrom); where.push(`t.due_at >= $${values.length}`); }
    if (query.dueTo) { values.push(query.dueTo); where.push(`t.due_at < $${values.length}`); }
    if (query.q) {
      values.push(`%${escapeLike(query.q)}%`);
      where.push(`(t.title ILIKE $${values.length} ESCAPE '!' OR COALESCE(o.name,'') ILIKE $${values.length} ESCAPE '!' OR COALESCE(c.name,'') ILIKE $${values.length} ESCAPE '!' OR COALESCE(l.business_name,'') ILIKE $${values.length} ESCAPE '!' OR COALESCE(d.title,'') ILIKE $${values.length} ESCAPE '!')`);
    }
  }

  private requireText(value: string) {
    const text = value.trim();
    if (!text) throw new BadRequestException("Task title is required");
    return text;
  }

  private optionalText(value: string | null | undefined) { return value?.trim() || null; }

  private validDueAt(value?: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException("Task due time must be a valid timestamp");
    return date;
  }

  private assertRange(from?: string, to?: string) {
    if (from && to && new Date(from).getTime() >= new Date(to).getTime()) throw new BadRequestException("Task due date range is invalid");
  }

  private actorLabelSql(alias: string) {
    return `CASE WHEN ${alias}.id IS NULL THEN NULL WHEN ${alias}.phone IS NOT NULL THEN 'اپراتور ·•••' || right(${alias}.phone,4) WHEN ${alias}.email IS NOT NULL THEN 'اپراتور ' || left(${alias}.email,1) || '…' ELSE 'اپراتور ' || left(${alias}.id::text,8) END`;
  }

  private async audit(manager: EntityManager, actorId: string, action: string, id: string, summary: Record<string, string | null> = {}) {
    await manager.query("INSERT INTO platform_audit_events (actor_user_id,action,target_type,target_id,summary) VALUES ($1,$2,'crm_task',$3,$4::jsonb)", [actorId, action, id, JSON.stringify(summary)]);
  }

  private assertEditable(task: Row) { if (task.archived_at) throw new ConflictException("Restore this Task before changing it"); }
}
