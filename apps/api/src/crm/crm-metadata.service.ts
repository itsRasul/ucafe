import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { normalizeCrmComparable, normalizeCrmName } from "./crm-normalization.util";
import { CrmCustomFieldDefinition, CrmCustomFieldEntityType, CrmCustomFieldOption, CrmCustomFieldType } from "./entities/crm-custom-field.entity";
import { CreateCrmCustomFieldDto, CreateCrmTagDto, UpdateCrmCustomFieldDto, UpdateCrmTagDto } from "./dto/crm-metadata.dto";
import { CrmScoringService } from "./crm-scoring.service";

type Row = Record<string, any>;
type Db = DataSource | EntityManager;

const targets: Record<CrmCustomFieldEntityType, { table: string; column: string; auditType: string }> = {
  ORGANIZATION: { table: "crm_organizations", column: "organization_id", auditType: "crm_organization" },
  CONTACT: { table: "crm_contacts", column: "contact_id", auditType: "crm_contact" },
  LEAD: { table: "crm_leads", column: "lead_id", auditType: "crm_lead" },
  DEAL: { table: "crm_deals", column: "deal_id", auditType: "crm_deal" },
};
const selectTypes = [CrmCustomFieldType.SingleSelect, CrmCustomFieldType.MultiSelect];

@Injectable()
export class CrmMetadataService {
  constructor(private readonly dataSource: DataSource, @Optional() private readonly scoring?: CrmScoringService) {}

  async listFields(entityType: CrmCustomFieldEntityType, includeInactive = false) {
    return this.listFieldsWith(this.dataSource, entityType, includeInactive);
  }

  async createField(input: CreateCrmCustomFieldDto, actorId: string) {
    this.assertOptions(input.dataType, input.options?.length ?? 0);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const rows = await manager.query<Row[]>(`
          INSERT INTO crm_custom_field_definitions (entity_type,key,label,description,data_type,required,sort_order,created_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
        `, [input.entityType, input.key, normalizeCrmName(input.label), this.optionalText(input.description), input.dataType, input.required ?? false, input.sortOrder ?? 0, actorId]);
        const id = rows[0]!.id as string;
        for (const [sortOrder, option] of (input.options ?? []).entries()) {
          await manager.query("INSERT INTO crm_custom_field_options (field_definition_id,label,sort_order) VALUES ($1,$2,$3)", [id, normalizeCrmName(option.label), sortOrder]);
        }
        await this.audit(manager, actorId, "crm.custom_field.created", "crm_custom_field_definition", id);
        return this.loadField(manager, id);
      });
    } catch (error) { this.rethrowConflict(error, "A custom field with this key already exists for the selected record type"); }
  }

  async getField(id: string) {
    return this.loadField(this.dataSource, id);
  }

  private async loadField(manager: Db, id: string) {
    const rows = await manager.query<Row[]>(`SELECT id,entity_type AS "entityType",key,label,description,data_type AS "dataType",required,active,sort_order AS "sortOrder",archived_at AS "archivedAt" FROM crm_custom_field_definitions WHERE id=$1`, [id]);
    if (!rows[0]) throw new NotFoundException("CRM custom field not found");
    const options = await manager.query<Row[]>(`SELECT id,label,active,sort_order AS "sortOrder",archived_at AS "archivedAt" FROM crm_custom_field_options WHERE field_definition_id=$1 ORDER BY sort_order,id`, [id]);
    return { ...rows[0], options };
  }

  async updateField(id: string, input: UpdateCrmCustomFieldDto, actorId: string) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const rows = await manager.query<Row[]>("SELECT * FROM crm_custom_field_definitions WHERE id=$1 FOR UPDATE", [id]);
        const current = rows[0];
        if (!current) throw new NotFoundException("CRM custom field not found");
        if (current.archived_at) throw new ConflictException("Archived custom fields cannot be edited");
        if (input.options !== undefined) {
          if (!selectTypes.includes(current.data_type)) throw new BadRequestException("Only select fields can have options");
          const oldRows = await manager.query<Row[]>("SELECT id,active,archived_at FROM crm_custom_field_options WHERE field_definition_id=$1 FOR UPDATE", [id]);
          const old = new Map(oldRows.map((option) => [option.id as string, option]));
          let order = 0;
          for (const option of input.options) {
            if (!option.id) {
              if (option.active === false) throw new BadRequestException("A new option cannot start archived");
              await manager.query("INSERT INTO crm_custom_field_options(field_definition_id,label,sort_order) VALUES($1,$2,$3)", [id, normalizeCrmName(option.label), order++]);
              continue;
            }
            const existing = old.get(option.id);
            if (!existing) throw new BadRequestException("Custom field option does not belong to this field");
            if (existing.archived_at && option.active !== false) throw new ConflictException("Archived options cannot be reactivated");
            const active = option.active ?? existing.active;
            await manager.query("UPDATE crm_custom_field_options SET label=$2,active=$3,archived_at=$4,sort_order=$5,updated_at=now() WHERE id=$1", [option.id, normalizeCrmName(option.label), active, active ? null : existing.archived_at ?? new Date(), order++]);
          }
        }
        await manager.query(`UPDATE crm_custom_field_definitions SET label=$2,description=$3,required=$4,active=$5,sort_order=$6,updated_at=now() WHERE id=$1`, [
          id, input.label === undefined ? current.label : normalizeCrmName(input.label), input.description === undefined ? current.description : this.optionalText(input.description),
          input.required ?? current.required, input.active ?? current.active, input.sortOrder ?? current.sort_order,
        ]);
        await this.audit(manager, actorId, "crm.custom_field.updated", "crm_custom_field_definition", id);
        if (current.entity_type === "LEAD") await this.scoring?.recalculateAllIn(manager, "CUSTOM_FIELD_CHANGED");
        return this.loadField(manager, id);
      });
    } catch (error) { this.rethrowConflict(error, "Custom field update conflicts with existing data"); }
  }

  async archiveField(id: string, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Row[]>("SELECT id,entity_type,archived_at FROM crm_custom_field_definitions WHERE id=$1 FOR UPDATE", [id]);
      if (!rows[0]) throw new NotFoundException("CRM custom field not found");
      if (!rows[0].archived_at) {
        await manager.query("UPDATE crm_custom_field_definitions SET active=FALSE,archived_at=now(),updated_at=now() WHERE id=$1", [id]);
        await this.audit(manager, actorId, "crm.custom_field.archived", "crm_custom_field_definition", id);
        if (rows[0].entity_type === "LEAD") await this.scoring?.recalculateAllIn(manager, "CUSTOM_FIELD_CHANGED");
      }
        return this.loadField(manager, id);
    });
  }

  async getRecordFields(entityType: CrmCustomFieldEntityType, recordId: string, manager: Db = this.dataSource) {
    const target = targets[entityType];
    const row = await manager.query<Row[]>(`SELECT custom_fields FROM ${target.table} WHERE id=$1`, [recordId]);
    if (!row[0]) throw new NotFoundException("CRM record not found");
    const values = (row[0].custom_fields ?? {}) as Record<string, unknown>;
    const definitions = await this.listFieldsWith(manager, entityType, true);
    return { fields: definitions.filter((field) => !field.archivedAt || Object.hasOwn(values, field.key)), values };
  }

  async updateRecordFields(entityType: CrmCustomFieldEntityType, recordId: string, input: Record<string, unknown>, actorId: string) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 100) throw new BadRequestException("Custom field values must be an object with at most 100 fields");
    return this.dataSource.transaction(async (manager) => {
      const target = targets[entityType];
      const rows = await manager.query<Row[]>(`SELECT id,custom_fields,archived_at${entityType === "LEAD" ? ",status" : entityType === "DEAL" ? ",status AS deal_status" : ""} FROM ${target.table} WHERE id=$1 FOR UPDATE`, [recordId]);
      const row = rows[0];
      if (!row) throw new NotFoundException("CRM record not found");
      if (row.archived_at) throw new ConflictException("Restore the CRM record before editing it");
      if ((entityType === "LEAD" && row.status === "CONVERTED") || (entityType === "DEAL" && row.deal_status !== "OPEN")) throw new ConflictException("Closed CRM records cannot be edited");
      const values = { ...((row.custom_fields ?? {}) as Record<string, unknown>) };
      const definitions = await manager.query<Row[]>("SELECT id,key,data_type,required FROM crm_custom_field_definitions WHERE entity_type=$1 AND active=TRUE AND archived_at IS NULL", [entityType]);
      const byKey = new Map(definitions.map((field) => [field.key as string, field]));
      for (const [key, value] of Object.entries(input)) {
        const field = byKey.get(key);
        if (!field) throw new BadRequestException(`Unknown or inactive custom field: ${key}`);
        if (value === null) {
          if (field.required) throw new BadRequestException(`${key} is required`);
          delete values[key];
          continue;
        }
        values[key] = await this.validateValue(manager, field, value);
      }
      for (const field of definitions) {
        if (!field.required || !Object.hasOwn(input, field.key)) continue;
        const value = values[field.key];
        if (field.required && (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0))) {
          throw new BadRequestException(`${field.key} is required`);
        }
      }
      await manager.query(`UPDATE ${target.table} SET custom_fields=$2::jsonb,updated_at=now()${entityType === "ORGANIZATION" || entityType === "CONTACT" || entityType === "LEAD" || entityType === "DEAL" ? ",updated_by_user_id=$3" : ""} WHERE id=$1`, [recordId, JSON.stringify(values), actorId]);
      await this.audit(manager, actorId, "crm.custom_fields.updated", target.auditType, recordId, { changedFields: Object.keys(input).length });
      if (entityType === "LEAD") await this.scoring?.recalculateLead(recordId, "CUSTOM_FIELD_CHANGED", manager);
      return this.getRecordFields(entityType, recordId, manager);
    });
  }

  async listTags(includeArchived = false) {
    return this.dataSource.query<Row[]>(`SELECT id,name,description,color,active,archived_at AS "archivedAt" FROM crm_tags WHERE $1::boolean OR (active=TRUE AND archived_at IS NULL) ORDER BY normalized_name,id`, [includeArchived]);
  }

  async createTag(input: CreateCrmTagDto, actorId: string) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const rows = await manager.query<Row[]>(`INSERT INTO crm_tags(name,normalized_name,description,color,created_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING id`, [normalizeCrmName(input.name), normalizeCrmComparable(input.name), this.optionalText(input.description), input.color ?? null, actorId]);
        await this.audit(manager, actorId, "crm.tag.created", "crm_tag", rows[0]!.id);
        return this.getTag(rows[0]!.id, manager);
      });
    } catch (error) { this.rethrowConflict(error, "A tag with this name already exists"); }
  }

  async updateTag(id: string, input: UpdateCrmTagDto, actorId: string) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const rows = await manager.query<Row[]>("SELECT * FROM crm_tags WHERE id=$1 FOR UPDATE", [id]);
        if (!rows[0]) throw new NotFoundException("CRM tag not found");
        if (rows[0].archived_at) throw new ConflictException("Archived tags cannot be edited");
        await manager.query(`UPDATE crm_tags SET name=$2,normalized_name=$3,description=$4,color=$5,updated_at=now() WHERE id=$1`, [id,
          input.name === undefined ? rows[0].name : normalizeCrmName(input.name), input.name === undefined ? rows[0].normalized_name : normalizeCrmComparable(input.name),
          input.description === undefined ? rows[0].description : this.optionalText(input.description), input.color === undefined ? rows[0].color : input.color]);
        await this.audit(manager, actorId, "crm.tag.updated", "crm_tag", id);
        return this.getTag(id, manager);
      });
    } catch (error) { this.rethrowConflict(error, "A tag with this name already exists"); }
  }

  async archiveTag(id: string, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const result = await manager.query<Row[]>("UPDATE crm_tags SET active=FALSE,archived_at=COALESCE(archived_at,now()),updated_at=now() WHERE id=$1 RETURNING id", [id]);
      if (!result[0]) throw new NotFoundException("CRM tag not found");
      await this.audit(manager, actorId, "crm.tag.archived", "crm_tag", id);
      await this.scoring?.recalculateAllIn(manager, "TAG_CHANGED");
      return this.getTag(id, manager);
    });
  }

  async getRecordTags(entityType: CrmCustomFieldEntityType, recordId: string, manager: Db = this.dataSource) {
    const target = targets[entityType];
    const record = await manager.query<Row[]>(`SELECT id FROM ${target.table} WHERE id=$1`, [recordId]);
    if (!record[0]) throw new NotFoundException("CRM record not found");
    return manager.query<Row[]>(`SELECT t.id,t.name,t.color,t.active,t.archived_at AS "archivedAt" FROM crm_entity_tags et JOIN crm_tags t ON t.id=et.tag_id WHERE et.${target.column}=$1 ORDER BY t.normalized_name,t.id`, [recordId]);
  }

  async setRecordTags(entityType: CrmCustomFieldEntityType, recordId: string, tagIds: string[], actorId: string) {
    if (new Set(tagIds).size !== tagIds.length) throw new BadRequestException("Duplicate tag IDs are not allowed");
    return this.dataSource.transaction(async (manager) => {
      const target = targets[entityType];
      const rows = await manager.query<Row[]>(`SELECT id,archived_at${entityType === "LEAD" ? ",status" : entityType === "DEAL" ? ",status AS deal_status" : ""} FROM ${target.table} WHERE id=$1 FOR UPDATE`, [recordId]);
      const row = rows[0];
      if (!row) throw new NotFoundException("CRM record not found");
      if (row.archived_at || (entityType === "LEAD" && row.status === "CONVERTED") || (entityType === "DEAL" && row.deal_status !== "OPEN")) throw new ConflictException("This CRM record cannot be changed");
      const existing = await manager.query<Row[]>(`SELECT tag_id FROM crm_entity_tags WHERE ${target.column}=$1`, [recordId]);
      const current = new Set(existing.map((item) => item.tag_id as string));
      const requested = new Set(tagIds);
      const newIds = tagIds.filter((id) => !current.has(id));
      if (newIds.length) {
        const valid = await manager.query<Row[]>("SELECT id FROM crm_tags WHERE id=ANY($1::uuid[]) AND active=TRUE AND archived_at IS NULL", [newIds]);
        if (valid.length !== newIds.length) throw new BadRequestException("One or more tags are missing or archived");
      }
      if (tagIds.length) await manager.query(`DELETE FROM crm_entity_tags WHERE ${target.column}=$1 AND NOT(tag_id=ANY($2::uuid[]))`, [recordId, tagIds]);
      else await manager.query(`DELETE FROM crm_entity_tags WHERE ${target.column}=$1`, [recordId]);
      for (const tagId of newIds) await manager.query(`INSERT INTO crm_entity_tags(tag_id,${target.column},assigned_by_user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [tagId, recordId, actorId]);
      const removed = [...current].filter((id) => !requested.has(id)).length;
      if (newIds.length || removed) await this.audit(manager, actorId, "crm.record_tags.updated", target.auditType, recordId, { added: newIds.length, removed });
      if (entityType === "LEAD" && (newIds.length || removed)) await this.scoring?.recalculateLead(recordId, "TAG_CHANGED", manager);
      return this.getRecordTags(entityType, recordId, manager);
    });
  }

  private async getTag(id: string, manager: Db = this.dataSource) {
    const rows = await manager.query<Row[]>("SELECT id,name,description,color,active,archived_at AS \"archivedAt\" FROM crm_tags WHERE id=$1", [id]);
    if (!rows[0]) throw new NotFoundException("CRM tag not found");
    return rows[0];
  }

  private async validateValue(manager: Db, field: Row, value: unknown): Promise<unknown> {
    const type = field.data_type as CrmCustomFieldType;
    const text = (max: number) => {
      if (typeof value !== "string" || !value.trim() || value.length > max) throw new BadRequestException(`${field.key} must be a non-empty string of at most ${max} characters`);
      return value.trim();
    };
    switch (type) {
      case CrmCustomFieldType.Text: return text(500);
      case CrmCustomFieldType.LongText: return text(4000);
      case CrmCustomFieldType.Url: {
        const raw = text(2048);
        try { const url = new URL(raw); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); return raw; }
        catch { throw new BadRequestException(`${field.key} must be an HTTP or HTTPS URL`); }
      }
      case CrmCustomFieldType.Number:
        if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) throw new BadRequestException(`${field.key} must be a finite number within range`);
        return value;
      case CrmCustomFieldType.Boolean:
        if (typeof value !== "boolean") throw new BadRequestException(`${field.key} must be true or false`);
        return value;
      case CrmCustomFieldType.Date:
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field.key} must be an ISO date (YYYY-MM-DD)`);
        return value;
      case CrmCustomFieldType.SingleSelect: {
        if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new BadRequestException(`${field.key} must be a valid option`);
        const rows = await manager.query<Row[]>("SELECT id FROM crm_custom_field_options WHERE id=$1 AND field_definition_id=$2 AND active=TRUE AND archived_at IS NULL", [value, field.id]);
        if (!rows[0]) throw new BadRequestException(`${field.key} must be an active option`);
        return value;
      }
      case CrmCustomFieldType.MultiSelect: {
        if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string") || new Set(value).size !== value.length) throw new BadRequestException(`${field.key} must be a unique list of up to 100 options`);
        const ids = value as string[];
        if (ids.length) {
          const rows = await manager.query<Row[]>("SELECT id FROM crm_custom_field_options WHERE id=ANY($1::uuid[]) AND field_definition_id=$2 AND active=TRUE AND archived_at IS NULL", [ids, field.id]);
          if (rows.length !== ids.length) throw new BadRequestException(`${field.key} contains an invalid or inactive option`);
        }
        return ids;
      }
      default: throw new BadRequestException("Unsupported custom field type");
    }
  }

  private assertOptions(type: CrmCustomFieldType, count: number) {
    if (selectTypes.includes(type) && count < 1) throw new BadRequestException("Select fields need at least one option");
    if (!selectTypes.includes(type) && count > 0) throw new BadRequestException("Only select fields can have options");
  }

  private optionalText(value: string | null | undefined) { return value == null || !value.trim() ? null : normalizeCrmName(value); }

  private async listFieldsWith(manager: Db, entityType: CrmCustomFieldEntityType, includeInactive: boolean) {
    return manager.query<Row[]>(`
      SELECT d.id,d.entity_type AS "entityType",d.key,d.label,d.description,d.data_type AS "dataType",d.required,d.active,d.sort_order AS "sortOrder",d.archived_at AS "archivedAt",
        COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'active',o.active,'sortOrder',o.sort_order,'archivedAt',o.archived_at) ORDER BY o.sort_order,o.id) FILTER (WHERE o.id IS NOT NULL), '[]'::jsonb) AS options
      FROM crm_custom_field_definitions d LEFT JOIN crm_custom_field_options o ON o.field_definition_id=d.id
      WHERE d.entity_type=$1 AND ($2::boolean OR (d.active=TRUE AND d.archived_at IS NULL))
      GROUP BY d.id ORDER BY d.sort_order,d.created_at,d.id
    `, [entityType, includeInactive]);
  }

  private async audit(manager: Db, actorId: string, action: string, targetType: string, targetId: string, summary: Record<string, unknown> = {}) {
    await manager.query("INSERT INTO platform_audit_events(actor_user_id,action,target_type,target_id,summary) VALUES($1,$2,$3,$4,$5::jsonb)", [actorId, action, targetType, targetId, JSON.stringify(summary)]);
  }

  private rethrowConflict(error: unknown, message: string): never {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "23505") throw new ConflictException(message);
    throw error;
  }
}
