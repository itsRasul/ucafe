import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { CrmLeadService } from "./crm-lead.service";
import { escapeLike, normalizeCrmName } from "./crm-normalization.util";
import { CRM_DEFAULT_PIPELINE, crmDealStageRequiresReason, isValidCrmDealAmount, isValidCrmDealDate } from "./crm-deal-lifecycle.util";
import { CreateCrmDealDto, ChangeCrmDealStageDto, CrmDealListQueryDto, LoseCrmDealDto, UpdateCrmDealDto } from "./dto/crm-deal.dto";
import { CRM_DEFAULT_PIPELINE_KEY, CrmDealLossReason, CrmDealStage, CrmDealStatus } from "./entities/crm-deal.entity";
import { CrmFilterService } from "./crm-filter.service";
import { CrmCustomFieldEntityType } from "./entities/crm-custom-field.entity";

type Row = Record<string, any>;
type ArchiveStatus = "ACTIVE" | "ARCHIVED" | "ALL";

@Injectable()
export class CrmDealService {
  constructor(private readonly dataSource: DataSource, private readonly leads: CrmLeadService, @Optional() private readonly filters?: CrmFilterService) {}

  pipeline() { return CRM_DEFAULT_PIPELINE; }

  async planOptions() {
    return this.dataSource.query<Array<{ id: string; key: string; name: string }>>(
      "SELECT id,key,name FROM subscription_plans WHERE status='ACTIVE' ORDER BY sort_order,id",
    );
  }

  async list(query: CrmDealListQueryDto) {
    this.assertDateRange(query.expectedCloseFrom, query.expectedCloseTo);
    const where: string[] = [];
    const values: unknown[] = [];
    this.addFilters(where, values, query);
    const filter = await this.filters?.compile(CrmCustomFieldEntityType.Deal, query.filter, values, { entity: "d", organization: "o" }) ?? "";
    if (filter) where.push(filter);
    const from = this.joins();
    const predicate = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const counts = await this.dataSource.query<Array<{ total: string }>>(`SELECT count(*)::text AS total ${from} ${predicate}`, values);
    const sort = {
      title: "d.title",
      createdAt: "d.created_at",
      updatedAt: "d.updated_at",
      expectedCloseDate: "d.expected_close_date",
      estimatedAmountToman: "d.estimated_amount_toman",
    }[query.sort];
    const nullsLast = query.sort === "expectedCloseDate" || query.sort === "estimatedAmountToman" ? " NULLS LAST" : "";
    const pageValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
    const items = await this.dataSource.query<Row[]>(`
      SELECT d.id,d.title,d.organization_id AS "organizationId",o.name AS "organizationName",o.city AS "organizationCity",
        d.primary_contact_id AS "primaryContactId",c.name AS "primaryContactName",c.role AS "primaryContactRole",
        d.originating_lead_id AS "originatingLeadId",l.business_name AS "originatingLeadName",
        d.owner_id AS "ownerId",${this.ownerLabelSql("u")} AS "ownerLabel",
        d.expected_plan_id AS "expectedPlanId",p.name AS "expectedPlanName",d.estimated_amount_toman AS "estimatedAmountToman",
        d.expected_close_date AS "expectedCloseDate",d.pipeline_key AS "pipelineKey",d.stage,d.status,
        d.loss_reason AS "lossReason",d.loss_reason_detail AS "lossReasonDetail",d.closed_at AS "closedAt",
        d.won_at AS "wonAt",d.lost_at AS "lostAt",d.archived_at AS "archivedAt",d.created_at AS "createdAt",d.updated_at AS "updatedAt"
      ${from} ${predicate}
      ORDER BY ${sort} ${query.direction}${nullsLast},d.id ASC
      LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}
    `, pageValues);
    const summaryWhere: string[] = [];
    const summaryValues: unknown[] = [];
    this.addFilters(summaryWhere, summaryValues, { ...query, status: CrmDealStatus.Open });
    const summaryFilter = await this.filters?.compile(CrmCustomFieldEntityType.Deal, query.filter, summaryValues, { entity: "d", organization: "o" }) ?? "";
    if (summaryFilter) summaryWhere.push(summaryFilter);
    const summaryPredicate = summaryWhere.length ? `WHERE ${summaryWhere.join(" AND ")}` : "";
    const totals = await this.dataSource.query<Array<{ stage: CrmDealStage; count: number; estimatedAmountToman: string }>>(`
      SELECT d.stage,count(*)::int AS count,COALESCE(sum(d.estimated_amount_toman),0)::text AS "estimatedAmountToman"
      FROM crm_deals d JOIN crm_organizations o ON o.id=d.organization_id
      LEFT JOIN crm_contacts c ON c.id=d.primary_contact_id
      LEFT JOIN crm_leads l ON l.id=d.originating_lead_id
      LEFT JOIN subscription_plans p ON p.id=d.expected_plan_id
      LEFT JOIN users u ON u.id=d.owner_id
      ${summaryPredicate} GROUP BY d.stage
    `, summaryValues);
    const totalByStage = new Map(totals.map((item) => [item.stage, item]));
    const stageTotals = CRM_DEFAULT_PIPELINE.stages.map(({ key }) => ({
      stage: key,
      count: totalByStage.get(key)?.count ?? 0,
      estimatedAmountToman: totalByStage.get(key)?.estimatedAmountToman ?? "0",
    }));
    return { items, total: Number(counts[0]?.total ?? 0), page: query.page, pageSize: query.pageSize, stageTotals };
  }

  async get(id: string) { return this.detail(this.dataSource, id); }

  async create(input: CreateCrmDealDto, actorId: string) {
    const title = this.requireText(input.title, "Deal title");
    const amount = input.estimatedAmountToman ?? null;
    const expectedCloseDate = input.expectedCloseDate ?? null;
    this.assertAmount(amount);
    this.assertDate(expectedCloseDate);
    const stage = input.stage ?? CrmDealStage.Discovery;
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireActiveOrganization(manager, input.organizationId);
        let primaryContactId = input.primaryContactId ?? null;
        if (input.originatingLeadId) {
          const lead = await this.requireEligibleLead(manager, input.originatingLeadId);
          if (lead.organization_id !== input.organizationId) throw new BadRequestException("The originating Lead belongs to a different Organization");
          primaryContactId ??= lead.primary_contact_id;
          const existingDeals = await manager.query<Row[]>("SELECT id FROM crm_deals WHERE originating_lead_id=$1", [input.originatingLeadId]);
          if (existingDeals[0]) {
            throw new ConflictException("This Lead already has a Deal");
          }
        }
        await this.assertPrimaryContact(manager, primaryContactId, input.organizationId);
        await this.leads.assertCrmAssignee(manager, input.ownerId ?? null);
        await this.assertActivePlan(manager, input.expectedPlanId ?? null);
        const rows = await manager.query<Row[]>(`
          INSERT INTO crm_deals (organization_id,primary_contact_id,originating_lead_id,owner_id,expected_plan_id,pipeline_key,title,
            estimated_amount_toman,expected_close_date,stage,created_by_user_id,updated_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id
        `, [input.organizationId, primaryContactId, input.originatingLeadId ?? null, input.ownerId ?? null,
          input.expectedPlanId ?? null, CRM_DEFAULT_PIPELINE_KEY, title, amount, expectedCloseDate, stage, actorId]);
        const id = rows[0]!.id as string;
        await manager.query(`INSERT INTO crm_deal_stage_history (deal_id,pipeline_key,from_stage,to_stage,changed_by_user_id) VALUES ($1,$2,NULL,$3,$4)`, [id, CRM_DEFAULT_PIPELINE_KEY, stage, actorId]);
        await this.audit(manager, actorId, "crm.deal.created", id, { stage });
        return this.detail(manager, id);
      });
    } catch (error) { this.rethrowDatabaseError(error); }
  }

  async update(id: string, input: UpdateCrmDealDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.requireLockedDeal(manager, id);
      this.assertEditable(deal);
      this.assertOpen(deal);
      const title = input.title === undefined ? deal.title : this.requireText(input.title, "Deal title");
      const contactId = input.primaryContactId === undefined ? deal.primary_contact_id : input.primaryContactId;
      if (input.primaryContactId !== undefined && contactId !== deal.primary_contact_id) await this.assertPrimaryContact(manager, contactId, deal.organization_id);
      const ownerId = input.ownerId === undefined ? deal.owner_id : input.ownerId;
      if (input.ownerId !== undefined && ownerId !== deal.owner_id) await this.leads.assertCrmAssignee(manager, ownerId);
      const expectedPlanId = input.expectedPlanId === undefined ? deal.expected_plan_id : input.expectedPlanId;
      if (input.expectedPlanId !== undefined && expectedPlanId !== deal.expected_plan_id) await this.assertActivePlan(manager, expectedPlanId);
      const amount = input.estimatedAmountToman === undefined ? deal.estimated_amount_toman : input.estimatedAmountToman;
      const expectedCloseDate = input.expectedCloseDate === undefined ? deal.expected_close_date : input.expectedCloseDate;
      this.assertAmount(amount);
      this.assertDate(expectedCloseDate);
      await manager.query(`
        UPDATE crm_deals SET title=$2,primary_contact_id=$3,owner_id=$4,expected_plan_id=$5,estimated_amount_toman=$6,
          expected_close_date=$7,updated_by_user_id=$8,updated_at=now() WHERE id=$1
      `, [id, title, contactId, ownerId, expectedPlanId, amount, expectedCloseDate, actorId]);
      await this.audit(manager, actorId, "crm.deal.updated", id);
      return this.detail(manager, id);
    });
  }

  async changeStage(id: string, input: ChangeCrmDealStageDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.requireLockedDeal(manager, id);
      this.assertEditable(deal);
      this.assertOpen(deal);
      const current = deal.stage as CrmDealStage;
      if (current !== input.expectedStage) throw new ConflictException("Deal stage changed; refresh and try again");
      if (current === input.stage) throw new ConflictException("Deal is already in that stage");
      const reason = input.reason?.trim() || null;
      if (crmDealStageRequiresReason(current, input.stage) && !reason) throw new BadRequestException("A reason is required when skipping or correcting a stage");
      await manager.query("UPDATE crm_deals SET stage=$2,updated_by_user_id=$3,updated_at=now() WHERE id=$1", [id, input.stage, actorId]);
      await manager.query(`INSERT INTO crm_deal_stage_history (deal_id,pipeline_key,from_stage,to_stage,reason,changed_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)`, [id, deal.pipeline_key, current, input.stage, reason, actorId]);
      await this.audit(manager, actorId, "crm.deal.stage_changed", id, { from: current, to: input.stage });
      return this.detail(manager, id);
    });
  }

  async win(id: string, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.requireLockedDeal(manager, id);
      this.assertEditable(deal);
      this.assertOpen(deal);
      await manager.query("UPDATE crm_deals SET status='WON',closed_at=now(),won_at=now(),updated_by_user_id=$2,updated_at=now() WHERE id=$1", [id, actorId]);
      await this.audit(manager, actorId, "crm.deal.won", id, { stage: deal.stage });
      return this.detail(manager, id);
    });
  }

  async lose(id: string, input: LoseCrmDealDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.requireLockedDeal(manager, id);
      this.assertEditable(deal);
      this.assertOpen(deal);
      const detail = input.reason === CrmDealLossReason.Other ? this.optionalText(input.detail) : null;
      await manager.query(`UPDATE crm_deals SET status='LOST',closed_at=now(),lost_at=now(),loss_reason=$2,loss_reason_detail=$3,updated_by_user_id=$4,updated_at=now() WHERE id=$1`, [id, input.reason, detail, actorId]);
      await this.audit(manager, actorId, "crm.deal.lost", id, { reason: input.reason, stage: deal.stage });
      return this.detail(manager, id);
    });
  }

  async archive(id: string, actorId: string) { return this.setArchived(id, actorId, true); }
  async restore(id: string, actorId: string) { return this.setArchived(id, actorId, false); }

  private async setArchived(id: string, actorId: string, archive: boolean) {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.requireLockedDeal(manager, id);
      if (Boolean(deal.archived_at) === archive) return this.detail(manager, id);
      await manager.query("UPDATE crm_deals SET archived_at=$2,updated_by_user_id=$3,updated_at=now() WHERE id=$1", [id, archive ? new Date() : null, actorId]);
      await this.audit(manager, actorId, archive ? "crm.deal.archived" : "crm.deal.restored", id);
      return this.detail(manager, id);
    });
  }

  private async detail(manager: DataSource | EntityManager, id: string) {
    const deal = await this.findDeal(manager, id);
    if (!deal) throw new NotFoundException("CRM Deal not found");
    const history = await manager.query<Row[]>(`
      SELECT h.id,h.pipeline_key AS "pipelineKey",h.from_stage AS "fromStage",h.to_stage AS "toStage",h.reason,
        h.created_at AS "createdAt",${this.ownerLabelSql("u")} AS "actorLabel"
      FROM crm_deal_stage_history h LEFT JOIN users u ON u.id=h.changed_by_user_id
      WHERE h.deal_id=$1 ORDER BY h.created_at,h.id
    `, [id]);
    return { ...this.project(deal), stageHistory: history };
  }

  private async findDeal(manager: DataSource | EntityManager, id: string, lock = false): Promise<Row | null> {
    const rows = await manager.query<Row[]>(`
      SELECT d.*,o.name AS organization_name,o.city AS organization_city,c.name AS primary_contact_name,c.role AS primary_contact_role,
        l.business_name AS originating_lead_name,p.name AS expected_plan_name,${this.ownerLabelSql("u")} AS owner_label
      FROM crm_deals d JOIN crm_organizations o ON o.id=d.organization_id
      LEFT JOIN crm_contacts c ON c.id=d.primary_contact_id
      LEFT JOIN crm_leads l ON l.id=d.originating_lead_id
      LEFT JOIN subscription_plans p ON p.id=d.expected_plan_id
      LEFT JOIN users u ON u.id=d.owner_id
      WHERE d.id=$1 ${lock ? "FOR UPDATE OF d" : ""}
    `, [id]);
    return rows[0] ?? null;
  }

  private project(row: Row) {
    return {
      id: row.id,title: row.title,organizationId: row.organization_id,organizationName: row.organization_name,organizationCity: row.organization_city,
      primaryContactId: row.primary_contact_id,primaryContact: row.primary_contact_id ? { id: row.primary_contact_id,name: row.primary_contact_name,role: row.primary_contact_role } : null,
      originatingLeadId: row.originating_lead_id,originatingLeadName: row.originating_lead_name,
      ownerId: row.owner_id,ownerLabel: row.owner_label,expectedPlanId: row.expected_plan_id,expectedPlanName: row.expected_plan_name,
      estimatedAmountToman: row.estimated_amount_toman,expectedCloseDate: row.expected_close_date,pipelineKey: row.pipeline_key,stage: row.stage,status: row.status,
      lossReason: row.loss_reason,lossReasonDetail: row.loss_reason_detail,closedAt: row.closed_at,wonAt: row.won_at,lostAt: row.lost_at,
      archivedAt: row.archived_at,createdAt: row.created_at,updatedAt: row.updated_at,
    };
  }

  private addFilters(where: string[], values: unknown[], query: CrmDealListQueryDto) {
    if (query.archiveStatus === "ACTIVE") where.push("d.archived_at IS NULL");
    else if (query.archiveStatus === "ARCHIVED") where.push("d.archived_at IS NOT NULL");
    if (query.status) { values.push(query.status); where.push(`d.status=$${values.length}`); }
    if (query.stage) { values.push(query.stage); where.push(`d.stage=$${values.length}`); }
    if (query.ownerId === "UNASSIGNED") where.push("d.owner_id IS NULL");
    else if (query.ownerId) { values.push(query.ownerId); where.push(`d.owner_id=$${values.length}`); }
    if (query.organizationId) { values.push(query.organizationId); where.push(`d.organization_id=$${values.length}`); }
    if (query.expectedPlanId) { values.push(query.expectedPlanId); where.push(`d.expected_plan_id=$${values.length}`); }
    if (query.expectedCloseFrom) { values.push(query.expectedCloseFrom); where.push(`d.expected_close_date >= $${values.length}::date`); }
    if (query.expectedCloseTo) { values.push(query.expectedCloseTo); where.push(`d.expected_close_date <= $${values.length}::date`); }
    if (query.q) {
      values.push(`%${escapeLike(query.q.trim())}%`);
      const index = values.length;
      where.push(`(d.title ILIKE $${index} ESCAPE '!' OR o.name ILIKE $${index} ESCAPE '!' OR COALESCE(c.name,'') ILIKE $${index} ESCAPE '!')`);
    }
  }

  private joins() {
    return `FROM crm_deals d JOIN crm_organizations o ON o.id=d.organization_id
      LEFT JOIN crm_contacts c ON c.id=d.primary_contact_id
      LEFT JOIN crm_leads l ON l.id=d.originating_lead_id
      LEFT JOIN subscription_plans p ON p.id=d.expected_plan_id
      LEFT JOIN users u ON u.id=d.owner_id`;
  }

  private async requireLockedDeal(manager: EntityManager, id: string) {
    const deal = await this.findDeal(manager, id, true);
    if (!deal) throw new NotFoundException("CRM Deal not found");
    return deal;
  }

  private async requireActiveOrganization(manager: EntityManager, id: string) {
    const rows = await manager.query<Row[]>("SELECT archived_at FROM crm_organizations WHERE id=$1 FOR UPDATE", [id]);
    if (!rows[0]) throw new NotFoundException("CRM Organization not found");
    if (rows[0].archived_at) throw new ConflictException("Restore the Organization before creating a Deal");
  }

  private async assertPrimaryContact(manager: EntityManager, id: string | null, organizationId: string) {
    if (!id) return;
    const rows = await manager.query<Row[]>("SELECT organization_id,archived_at FROM crm_contacts WHERE id=$1 FOR UPDATE", [id]);
    if (!rows[0]) throw new NotFoundException("CRM Contact not found");
    if (rows[0].archived_at) throw new ConflictException("Restore the Contact before linking it to a Deal");
    if (rows[0].organization_id !== organizationId) throw new BadRequestException("The Contact belongs to a different Organization");
  }

  private async requireEligibleLead(manager: EntityManager, id: string) {
    const rows = await manager.query<Row[]>("SELECT organization_id,primary_contact_id,status,archived_at FROM crm_leads WHERE id=$1 FOR UPDATE", [id]);
    if (!rows[0]) throw new NotFoundException("CRM Lead not found");
    if (rows[0].archived_at) throw new ConflictException("Restore the Lead before creating a Deal from it");
    if (!(["QUALIFIED", "CONVERTED"] as string[]).includes(rows[0].status) || !rows[0].organization_id || (rows[0].status === "CONVERTED" && !rows[0].primary_contact_id)) {
      throw new BadRequestException("A Deal requires a qualified or converted Lead linked to an Organization");
    }
    return rows[0];
  }

  private async assertActivePlan(manager: EntityManager, id: string | null) {
    if (!id) return;
    const rows = await manager.query<Row[]>("SELECT id FROM subscription_plans WHERE id=$1 AND status='ACTIVE'", [id]);
    if (!rows[0]) throw new BadRequestException("Choose an active plan");
  }

  private ownerLabelSql(alias: string) {
    return `CASE WHEN ${alias}.id IS NULL THEN NULL WHEN ${alias}.phone IS NOT NULL THEN 'اپراتور ·•••' || right(${alias}.phone,4) WHEN ${alias}.email IS NOT NULL THEN 'اپراتور ' || left(${alias}.email,1) || '…' ELSE 'اپراتور ' || left(${alias}.id::text,8) END`;
  }

  private assertAmount(value: string | null) {
    if (value !== null && !isValidCrmDealAmount(value)) throw new BadRequestException("Deal value must be a non-negative integer Toman amount");
  }

  private assertDate(value: string | null) {
    if (value !== null && !isValidCrmDealDate(value)) throw new BadRequestException("Expected close date must be a valid ISO date");
  }

  private assertDateRange(from?: string, to?: string) {
    this.assertDate(from ?? null);
    this.assertDate(to ?? null);
    if (from && to && from > to) throw new BadRequestException("Expected close date range is invalid");
  }

  private requireText(value: string, label: string) {
    const normalized = normalizeCrmName(value ?? "");
    if (!normalized) throw new BadRequestException(`${label} is required`);
    return normalized;
  }

  private optionalText(value: string | null | undefined) {
    return value === null || value === undefined || !value.trim() ? null : normalizeCrmName(value);
  }

  private assertEditable(deal: Row) {
    if (deal.archived_at) throw new ConflictException("Restore this Deal before changing it");
  }

  private assertOpen(deal: Row) {
    if (deal.status !== CrmDealStatus.Open) throw new ConflictException("Closed Deals cannot be changed");
  }

  private async audit(manager: EntityManager, actorId: string, action: string, id: string, summary: Record<string, string | null> = {}) {
    await manager.query("INSERT INTO platform_audit_events (actor_user_id,action,target_type,target_id,summary) VALUES ($1,$2,'crm_deal',$3,$4::jsonb)", [actorId, action, id, JSON.stringify(summary)]);
  }

  private rethrowDatabaseError(error: unknown): never {
    const database = error as { code?: string; constraint?: string };
    if (database?.code === "23505" && database.constraint === "uq_crm_deals_originating_lead") throw new ConflictException("This Lead already has a Deal");
    if (database?.code === "23503") throw new BadRequestException("A linked CRM record or plan is no longer available");
    if (database?.code === "23514") throw new BadRequestException("Deal values are invalid");
    throw error;
  }
}
