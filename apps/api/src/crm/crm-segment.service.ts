import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CrmCustomFieldEntityType } from "./entities/crm-custom-field.entity";
import { CreateCrmSegmentDto, UpdateCrmSegmentDto } from "./dto/crm-saved-view.dto";
import { CrmFilterService } from "./crm-filter.service";

type Row = Record<string, any>;
const config: Record<CrmCustomFieldEntityType, { from: string; alias: string; organization?: string; display: string; subtitle: string }> = {
  ORGANIZATION: { from: "crm_organizations o", alias: "o", organization: "o", display: "o.name", subtitle: "COALESCE(o.city,'')" },
  CONTACT: { from: "crm_contacts c JOIN crm_organizations o ON o.id=c.organization_id", alias: "c", organization: "o", display: "c.name", subtitle: "o.name" },
  LEAD: { from: "crm_leads l LEFT JOIN crm_organizations o ON o.id=l.organization_id", alias: "l", organization: "o", display: "l.business_name", subtitle: "COALESCE(l.city,'')" },
  DEAL: { from: "crm_deals d JOIN crm_organizations o ON o.id=d.organization_id", alias: "d", organization: "o", display: "d.title", subtitle: "o.name" },
};

@Injectable()
export class CrmSegmentService {
  constructor(private readonly dataSource: DataSource, private readonly filters: CrmFilterService) {}

  async list(entityType?: CrmCustomFieldEntityType) {
    const rows = await this.dataSource.query<Row[]>(`
      SELECT id,name,description,entity_type AS "entityType",filter_definition AS "filterDefinition",created_at AS "createdAt",updated_at AS "updatedAt"
      FROM crm_segments WHERE archived_at IS NULL AND ($1::varchar IS NULL OR entity_type=$1)
      ORDER BY entity_type,name,id
    `, [entityType ?? null]);
    return Promise.all(rows.map(async (row) => ({ ...row, criteriaValid: await this.criteriaValid(row) })));
  }

  async get(id: string) {
    const segment = await this.find(id);
    return { ...segment, criteriaValid: await this.criteriaValid(segment) };
  }

  async create(input: CreateCrmSegmentDto, actorId: string) {
    await this.validate(input.entityType, input.filterDefinition);
    const rows = await this.dataSource.query<Row[]>(`
      INSERT INTO crm_segments(name,description,entity_type,filter_definition,created_by_user_id)
      VALUES($1,$2,$3,$4::jsonb,$5)
      RETURNING id,name,description,entity_type AS "entityType",filter_definition AS "filterDefinition",created_at AS "createdAt",updated_at AS "updatedAt"
    `, [input.name, input.description?.trim() || null, input.entityType, JSON.stringify(input.filterDefinition), actorId]);
    await this.audit(actorId, "crm.segment.created", rows[0]!.id);
    return rows[0];
  }

  async update(id: string, input: UpdateCrmSegmentDto, actorId: string) {
    const current = await this.find(id);
    const filterDefinition = input.filterDefinition ?? current.filterDefinition;
    await this.validate(current.entityType, filterDefinition);
    const rows = await this.dataSource.query<Row[]>(`
      UPDATE crm_segments SET name=$2,description=$3,filter_definition=$4::jsonb,updated_at=now() WHERE id=$1
      RETURNING id,name,description,entity_type AS "entityType",filter_definition AS "filterDefinition",created_at AS "createdAt",updated_at AS "updatedAt"
    `, [id, input.name ?? current.name, input.description === undefined ? current.description : input.description?.trim() || null, JSON.stringify(filterDefinition)]);
    await this.audit(actorId, "crm.segment.updated", id);
    return rows[0];
  }

  async archive(id: string, actorId: string) {
    const rows = await this.dataSource.query<Row[]>("UPDATE crm_segments SET archived_at=COALESCE(archived_at,now()),updated_at=now() WHERE id=$1 RETURNING id", [id]);
    if (!rows[0]) throw new NotFoundException("CRM segment not found");
    await this.audit(actorId, "crm.segment.archived", id);
    return { id, archived: true };
  }

  async preview(id: string) {
    const segment = await this.find(id);
    return this.previewFor(segment);
  }

  async previewDefinition(entityType: CrmCustomFieldEntityType, filterDefinition: Record<string, unknown>) {
    return this.previewFor({ entityType, filterDefinition });
  }

  private async previewFor(segment: Row) {
    const setup = await this.querySetup(segment);
    const count = await this.dataSource.query<Row[]>(`SELECT count(*)::text AS total ${setup.from} WHERE ${setup.where}`, setup.values);
    const items = await this.dataSource.query<Row[]>(`SELECT ${setup.alias}.id,${setup.display} AS "name",${setup.subtitle} AS "subtitle" ${setup.from} WHERE ${setup.where} ORDER BY ${setup.alias}.created_at DESC,${setup.alias}.id ASC LIMIT 5`, setup.values);
    return { count: Number(count[0]?.total ?? 0), items, entityType: segment.entityType, criteriaValid: true };
  }

  async records(id: string, page: number, pageSize: number) {
    const segment = await this.find(id);
    const setup = await this.querySetup(segment);
    const count = await this.dataSource.query<Row[]>(`SELECT count(*)::text AS total ${setup.from} WHERE ${setup.where}`, setup.values);
    const pageValues = [...setup.values, pageSize, (page - 1) * pageSize];
    const items = await this.dataSource.query<Row[]>(`SELECT ${setup.alias}.id,${setup.display} AS "name",${setup.subtitle} AS "subtitle" ${setup.from} WHERE ${setup.where} ORDER BY ${setup.alias}.created_at DESC,${setup.alias}.id ASC LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`, pageValues);
    return { items, total: Number(count[0]?.total ?? 0), page, pageSize };
  }

  private async querySetup(segment: Row) {
    const entityType = segment.entityType as CrmCustomFieldEntityType;
    const source = config[entityType];
    if (!source) throw new BadRequestException("Unsupported segment entity type");
    const values: unknown[] = [];
    const aliases = { entity: source.alias, organization: source.organization };
    const filtered = await this.filters.compile(entityType, segment.filterDefinition, values, aliases);
    const where = [`${source.alias}.archived_at IS NULL`, ...(filtered ? [filtered] : [])].join(" AND ");
    return { from: `FROM ${source.from}`, alias: source.alias, organization: source.organization, display: source.display, subtitle: source.subtitle, values, where };
  }

  private async validate(entityType: CrmCustomFieldEntityType, filterDefinition: unknown) {
    await this.filters.compile(entityType, filterDefinition, [], { entity: config[entityType].alias, organization: config[entityType].organization });
  }

  private async criteriaValid(segment: Row) {
    try { await this.validate(segment.entityType, segment.filterDefinition); return true; }
    catch { return false; }
  }

  private async find(id: string) {
    const rows = await this.dataSource.query<Row[]>(`
      SELECT id,name,description,entity_type AS "entityType",filter_definition AS "filterDefinition",created_at AS "createdAt",updated_at AS "updatedAt"
      FROM crm_segments WHERE id=$1 AND archived_at IS NULL
    `, [id]);
    if (!rows[0]) throw new NotFoundException("CRM segment not found");
    return rows[0];
  }

  private async audit(actorId: string, action: string, id: string) {
    await this.dataSource.query("INSERT INTO platform_audit_events(actor_user_id,action,target_type,target_id,summary) VALUES($1,$2,'crm_segment',$3,'{}'::jsonb)", [actorId, action, id]);
  }
}
