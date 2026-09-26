import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CrmCustomFieldEntityType } from "./entities/crm-custom-field.entity";
import { CreateCrmSavedViewDto, UpdateCrmSavedViewDto } from "./dto/crm-saved-view.dto";
import { CrmFilterService } from "./crm-filter.service";

type Row = Record<string, any>;
const aliases = (entityType: CrmCustomFieldEntityType) => ({
  ORGANIZATION: { entity: "o", organization: "o" },
  CONTACT: { entity: "c", organization: "o" },
  LEAD: { entity: "l", organization: "o" },
  DEAL: { entity: "d", organization: "o" },
}[entityType]);

@Injectable()
export class CrmSavedViewService {
  constructor(private readonly dataSource: DataSource, private readonly filters: CrmFilterService) {}

  async list(entityType: CrmCustomFieldEntityType, actorId: string) {
    const rows = await this.dataSource.query<Row[]>(`
      SELECT id,name,entity_type AS "entityType",visibility,owner_id AS "ownerId",filter_definition AS "filterDefinition",query_definition AS "queryDefinition",sort_definition AS "sortDefinition",created_at AS "createdAt",updated_at AS "updatedAt",owner_id=$2 AS "canEdit"
      FROM crm_saved_views WHERE entity_type=$1 AND archived_at IS NULL AND (visibility='SHARED' OR owner_id=$2)
      ORDER BY (visibility='SHARED') DESC,name,id
    `, [entityType, actorId]);
    return Promise.all(rows.map((row) => this.withValidation(row)));
  }

  async get(id: string, actorId: string) {
    const rows = await this.dataSource.query<Row[]>(`
      SELECT id,name,entity_type AS "entityType",visibility,owner_id AS "ownerId",filter_definition AS "filterDefinition",query_definition AS "queryDefinition",sort_definition AS "sortDefinition",created_at AS "createdAt",updated_at AS "updatedAt",owner_id=$2 AS "canEdit"
      FROM crm_saved_views WHERE id=$1 AND archived_at IS NULL AND (visibility='SHARED' OR owner_id=$2)
    `, [id, actorId]);
    if (!rows[0]) throw new NotFoundException("CRM saved view not found");
    return this.withValidation(rows[0]);
  }

  async create(input: CreateCrmSavedViewDto, actorId: string) {
    await this.validate(input.entityType, input.filterDefinition, input.sortDefinition);
    const queryDefinition = this.validateQueryDefinition(input.entityType, input.queryDefinition ?? {});
    const rows = await this.dataSource.query<Row[]>(`
      INSERT INTO crm_saved_views(name,entity_type,visibility,owner_id,filter_definition,query_definition,sort_definition)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)
      RETURNING id,name,entity_type AS "entityType",visibility,owner_id AS "ownerId",filter_definition AS "filterDefinition",query_definition AS "queryDefinition",sort_definition AS "sortDefinition",created_at AS "createdAt",updated_at AS "updatedAt",TRUE AS "canEdit"
    `, [input.name, input.entityType, input.visibility, actorId, JSON.stringify(input.filterDefinition), JSON.stringify(queryDefinition), input.sortDefinition ? JSON.stringify(await this.filters.validateSort(input.entityType, input.sortDefinition)) : null]);
    await this.audit(actorId, "crm.saved_view.created", rows[0]!.id);
    return this.withValidation(rows[0]!);
  }

  async update(id: string, input: UpdateCrmSavedViewDto, actorId: string) {
    const rows = await this.dataSource.query<Row[]>("SELECT * FROM crm_saved_views WHERE id=$1 AND archived_at IS NULL AND owner_id=$2", [id, actorId]);
    const current = rows[0];
    if (!current) throw new NotFoundException("CRM saved view not found");
    const filterDefinition = input.filterDefinition ?? current.filter_definition;
    const queryDefinition = this.validateQueryDefinition(current.entity_type, input.queryDefinition ?? current.query_definition);
    const sortDefinition = input.sortDefinition === undefined ? current.sort_definition : input.sortDefinition;
    await this.validate(current.entity_type, filterDefinition, sortDefinition);
    const updated = await this.dataSource.query<Row[]>(`
      UPDATE crm_saved_views SET name=$2,visibility=$3,filter_definition=$4::jsonb,query_definition=$5::jsonb,sort_definition=$6::jsonb,updated_at=now()
      WHERE id=$1 RETURNING id,name,entity_type AS "entityType",visibility,owner_id AS "ownerId",filter_definition AS "filterDefinition",query_definition AS "queryDefinition",sort_definition AS "sortDefinition",created_at AS "createdAt",updated_at AS "updatedAt",TRUE AS "canEdit"
    `, [id, input.name ?? current.name, input.visibility ?? current.visibility, JSON.stringify(filterDefinition), JSON.stringify(queryDefinition), sortDefinition ? JSON.stringify(await this.filters.validateSort(current.entity_type, sortDefinition)) : null]);
    await this.audit(actorId, "crm.saved_view.updated", id);
    return this.withValidation(updated[0]!);
  }

  async archive(id: string, actorId: string) {
    const rows = await this.dataSource.query<Row[]>("UPDATE crm_saved_views SET archived_at=COALESCE(archived_at,now()),updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING id", [id, actorId]);
    if (!rows[0]) throw new NotFoundException("CRM saved view not found");
    await this.audit(actorId, "crm.saved_view.archived", id);
    return { id, archived: true };
  }

  private async validate(entityType: CrmCustomFieldEntityType, filterDefinition: unknown, sortDefinition: unknown) {
    await this.filters.compile(entityType, filterDefinition, [], aliases(entityType));
    await this.filters.validateSort(entityType, sortDefinition);
  }

  private validateQueryDefinition(entityType: CrmCustomFieldEntityType, input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("Saved query filters must be an object");
    const allowed: Record<CrmCustomFieldEntityType, string[]> = {
      ORGANIZATION: ["q", "city", "archiveStatus", "tenantLink"],
      CONTACT: ["q", "organizationId", "archiveStatus"],
      LEAD: ["q", "status", "source", "priority", "ownerId", "organizationId", "city", "archiveStatus"],
      DEAL: ["q", "status", "stage", "ownerId", "organizationId", "expectedPlanId", "expectedCloseFrom", "expectedCloseTo", "archiveStatus"],
    };
    const values = input as Record<string, unknown>;
    if (Object.keys(values).some((key) => !allowed[entityType].includes(key))) throw new BadRequestException("Saved query contains an unsupported filter");
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== "string" || value.length > 500) throw new BadRequestException(`Saved query filter ${key} is invalid`);
    }
    const enums: Record<CrmCustomFieldEntityType, Record<string, string[]>> = {
      ORGANIZATION: {}, CONTACT: {},
      LEAD: {
        status: ["NEW", "ATTEMPTING_CONTACT", "CONTACTED", "QUALIFIED", "NURTURING", "UNQUALIFIED", "CONVERTED"],
        source: ["OUTBOUND_CALL", "LANDING_FORM", "SEO", "INSTAGRAM", "REFERRAL", "SMS", "PARTNER", "MANUAL", "OTHER"],
        priority: ["LOW", "NORMAL", "HIGH"],
      },
      DEAL: {
        status: ["OPEN", "WON", "LOST"],
        stage: ["DISCOVERY", "DEMO_SCHEDULED", "DEMO_COMPLETED", "TRIAL_PROPOSED", "TRIAL_ACTIVE", "DECISION"],
      },
    };
    for (const [key, allowedValues] of Object.entries(enums[entityType])) {
      const value = values[key];
      if (typeof value === "string" && value && !allowedValues.includes(value)) throw new BadRequestException(`Saved query filter ${key} is unsupported`);
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const key of ["organizationId", "expectedPlanId"]) {
      const value = values[key];
      if (typeof value === "string" && value && !uuid.test(value)) throw new BadRequestException(`Saved query filter ${key} is invalid`);
    }
    const ownerId = values.ownerId;
    if (typeof ownerId === "string" && ownerId && ownerId !== "UNASSIGNED" && !uuid.test(ownerId)) throw new BadRequestException("Saved query owner is invalid");
    for (const key of ["expectedCloseFrom", "expectedCloseTo"]) {
      const value = values[key];
      if (typeof value === "string" && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) throw new BadRequestException(`Saved query filter ${key} must be YYYY-MM-DD`);
    }
    if (values.archiveStatus !== undefined && !["ACTIVE", "ARCHIVED", "ALL"].includes(String(values.archiveStatus))) throw new BadRequestException("Saved archive filter is invalid");
    if (values.tenantLink !== undefined && !["LINKED", "UNLINKED"].includes(String(values.tenantLink))) throw new BadRequestException("Saved Tenant filter is invalid");
    return values;
  }

  private async withValidation(row: Row) {
    try {
      await this.validate(row.entityType, row.filterDefinition, row.sortDefinition);
      this.validateQueryDefinition(row.entityType, row.queryDefinition ?? {});
      return { ...row, criteriaValid: true, criteriaError: null };
    } catch (error) {
      return { ...row, criteriaValid: false, criteriaError: error instanceof Error ? error.message : "Saved view criteria is invalid" };
    }
  }

  private async audit(actorId: string, action: string, id: string) {
    await this.dataSource.query("INSERT INTO platform_audit_events(actor_user_id,action,target_type,target_id,summary) VALUES($1,$2,'crm_saved_view',$3,'{}'::jsonb)", [actorId, action, id]);
  }
}
