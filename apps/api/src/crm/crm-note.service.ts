import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { CrmNoteListQueryDto, CreateCrmNoteDto, UpdateCrmNoteDto } from "./dto/crm-work.dto";
import { resolveCrmWorkLinks } from "./crm-work-relations.util";

type Row = Record<string, any>;

@Injectable()
export class CrmNoteService {
  constructor(private readonly dataSource: DataSource) {}

  async list(query: CrmNoteListQueryDto) {
    const where: string[] = [];
    const values: unknown[] = [];
    this.addFilters(where, values, query);
    const predicate = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const from = this.fromSql();
    const counts = await this.dataSource.query<Array<{ total: string }>>(`SELECT count(*)::text AS total ${from} ${predicate}`, values);
    const sort = query.sort === "updatedAt" ? "n.updated_at" : "n.created_at";
    const pageValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
    const items = await this.dataSource.query<Row[]>(`SELECT ${this.columnsSql()} ${from} ${predicate}
      ORDER BY ${sort} ${query.direction},n.id DESC LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`, pageValues);
    return { items, total: Number(counts[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async get(id: string) { return this.detail(this.dataSource, id); }

  async create(input: CreateCrmNoteDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const links = await resolveCrmWorkLinks(manager, input);
      const rows = await manager.query<Row[]>(`INSERT INTO crm_notes (organization_id,contact_id,lead_id,deal_id,body,author_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`, [links.organizationId, links.contactId, links.leadId, links.dealId, input.body.trim(), actorId]);
      const id = rows[0]!.id as string;
      await this.audit(manager, actorId, "crm.note.created", id);
      return this.detail(manager, id);
    });
  }

  async update(id: string, input: UpdateCrmNoteDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const note = await this.findNote(manager, id, true);
      if (!note) throw new NotFoundException("CRM Note not found");
      this.assertEditable(note);
      const links = await resolveCrmWorkLinks(manager, {
        organizationId: input.organizationId === undefined ? note.organization_id : input.organizationId,
        contactId: input.contactId === undefined ? note.contact_id : input.contactId,
        leadId: input.leadId === undefined ? note.lead_id : input.leadId,
        dealId: input.dealId === undefined ? note.deal_id : input.dealId,
      });
      const body = input.body === undefined ? note.body : input.body.trim();
      await manager.query(`UPDATE crm_notes SET organization_id=$2,contact_id=$3,lead_id=$4,deal_id=$5,body=$6,updated_by_user_id=$7,updated_at=now() WHERE id=$1`, [
        id, links.organizationId, links.contactId, links.leadId, links.dealId, body, actorId,
      ]);
      await this.audit(manager, actorId, "crm.note.updated", id);
      return this.detail(manager, id);
    });
  }

  async archive(id: string, actorId: string) { return this.setArchived(id, actorId, true); }
  async restore(id: string, actorId: string) { return this.setArchived(id, actorId, false); }

  private async setArchived(id: string, actorId: string, archive: boolean) {
    return this.dataSource.transaction(async (manager) => {
      const note = await this.findNote(manager, id, true);
      if (!note) throw new NotFoundException("CRM Note not found");
      if (Boolean(note.archived_at) === archive) return this.project(note);
      await manager.query("UPDATE crm_notes SET archived_at=$2,archived_by_user_id=$3,updated_by_user_id=$4,updated_at=now() WHERE id=$1", [id, archive ? new Date() : null, archive ? actorId : null, actorId]);
      await this.audit(manager, actorId, archive ? "crm.note.archived" : "crm.note.restored", id);
      return this.detail(manager, id);
    });
  }

  private async detail(manager: DataSource | EntityManager, id: string) {
    const row = await this.findNote(manager, id);
    if (!row) throw new NotFoundException("CRM Note not found");
    return this.project(row);
  }

  private async findNote(manager: DataSource | EntityManager, id: string, lock = false): Promise<Row | null> {
    const rows = await manager.query<Row[]>(`SELECT n.*,COALESCE(n.organization_id,l.organization_id) AS effective_organization_id,
      o.name AS organization_name,c.name AS contact_name,c.role AS contact_role,l.business_name AS lead_name,d.title AS deal_title,
      ${this.actorLabelSql("u")} AS author_label
      ${this.fromSql()} WHERE n.id=$1 ${lock ? "FOR UPDATE OF n" : ""}`, [id]);
    return rows[0] ?? null;
  }

  private fromSql() {
    return `FROM crm_notes n
      LEFT JOIN crm_leads l ON l.id=n.lead_id
      LEFT JOIN crm_organizations o ON o.id=COALESCE(n.organization_id,l.organization_id)
      LEFT JOIN crm_contacts c ON c.id=n.contact_id
      LEFT JOIN crm_deals d ON d.id=n.deal_id
      LEFT JOIN users u ON u.id=n.author_user_id`;
  }

  private columnsSql() {
    return `n.id,COALESCE(n.organization_id,l.organization_id) AS "organizationId",o.name AS "organizationName",
      n.contact_id AS "contactId",c.name AS "contactName",c.role AS "contactRole",n.lead_id AS "leadId",l.business_name AS "leadName",
      n.deal_id AS "dealId",d.title AS "dealTitle",n.body,n.author_user_id AS "authorUserId",${this.actorLabelSql("u")} AS "authorLabel",
      n.updated_by_user_id AS "updatedByUserId",n.archived_at AS "archivedAt",n.created_at AS "createdAt",n.updated_at AS "updatedAt"`;
  }

  private project(row: Row) {
    return {
      id: row.id, organizationId: row.effective_organization_id ?? row.organizationId ?? row.organization_id ?? null,
      organizationName: row.organization_name ?? row.organizationName ?? null,
      contactId: row.contact_id ?? row.contactId ?? null, contactName: row.contact_name ?? row.contactName ?? null, contactRole: row.contact_role ?? row.contactRole ?? null,
      leadId: row.lead_id ?? row.leadId ?? null, leadName: row.lead_name ?? row.leadName ?? null,
      dealId: row.deal_id ?? row.dealId ?? null, dealTitle: row.deal_title ?? row.dealTitle ?? null,
      body: row.body, authorUserId: row.author_user_id ?? row.authorUserId ?? null, authorLabel: row.author_label ?? row.authorLabel ?? null,
      updatedByUserId: row.updated_by_user_id ?? row.updatedByUserId ?? null,
      archivedAt: row.archived_at ?? row.archivedAt ?? null, createdAt: row.created_at ?? row.createdAt, updatedAt: row.updated_at ?? row.updatedAt,
    };
  }

  private addFilters(where: string[], values: unknown[], query: CrmNoteListQueryDto) {
    if (query.archiveStatus === "ACTIVE") where.push("n.archived_at IS NULL");
    else if (query.archiveStatus === "ARCHIVED") where.push("n.archived_at IS NOT NULL");
    if (query.organizationId) { values.push(query.organizationId); where.push(`COALESCE(n.organization_id,l.organization_id)=$${values.length}`); }
    for (const [key, column] of [["contactId", "n.contact_id"], ["leadId", "n.lead_id"], ["dealId", "n.deal_id"]] as const) {
      const value = query[key];
      if (value) { values.push(value); where.push(`${column}=$${values.length}`); }
    }
  }

  private actorLabelSql(alias: string) {
    return `CASE WHEN ${alias}.id IS NULL THEN NULL WHEN ${alias}.phone IS NOT NULL THEN 'اپراتور ·•••' || right(${alias}.phone,4) WHEN ${alias}.email IS NOT NULL THEN 'اپراتور ' || left(${alias}.email,1) || '…' ELSE 'اپراتور ' || left(${alias}.id::text,8) END`;
  }

  private async audit(manager: EntityManager, actorId: string, action: string, id: string) {
    await manager.query("INSERT INTO platform_audit_events (actor_user_id,action,target_type,target_id,summary) VALUES ($1,$2,'crm_note',$3,'{}'::jsonb)", [actorId, action, id]);
  }

  private assertEditable(note: Row) { if (note.archived_at) throw new ConflictException("Restore this Note before editing it"); }
}
