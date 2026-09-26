import { BadRequestException, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CrmCustomFieldEntityType, CrmCustomFieldType } from "./entities/crm-custom-field.entity";
import { escapeLike } from "./crm-normalization.util";

type Row = Record<string, any>;
type ValueType = "TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "SELECT" | "MULTI_SELECT";
type Condition = { field: string; operator: string; value?: unknown };
type Filter = { version: 1; logic: "AND" | "OR"; conditions: Condition[] };
type Aliases = { entity: string; organization?: string; contact?: string; plan?: string };

const operators: Record<ValueType, string[]> = {
  TEXT: ["equals", "notEquals", "contains", "startsWith", "isEmpty", "isNotEmpty"],
  NUMBER: ["equals", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  BOOLEAN: ["isTrue", "isFalse"],
  DATE: ["equals", "before", "after", "between", "isEmpty", "isNotEmpty"],
  SELECT: ["is", "isNot", "in", "isEmpty", "isNotEmpty"],
  MULTI_SELECT: ["containsAny", "containsAll", "containsNone", "isEmpty", "isNotEmpty"],
};

const core: Record<CrmCustomFieldEntityType, Record<string, { label: string; type: ValueType; expression: (aliases: Aliases) => string; options?: { value: string; label: string }[] }>> = {
  ORGANIZATION: {
    name: { label: "نام سازمان", type: "TEXT", expression: ({ entity }) => `${entity}.name` },
    city: { label: "شهر", type: "TEXT", expression: ({ entity }) => `${entity}.city` },
    website: { label: "وب‌سایت", type: "TEXT", expression: ({ entity }) => `${entity}.website` },
    instagram: { label: "اینستاگرام", type: "TEXT", expression: ({ entity }) => `${entity}.instagram_handle` },
    tenantLinked: { label: "اتصال به کافه UCafe", type: "BOOLEAN", expression: ({ entity }) => `${entity}.coffee_shop_id IS NOT NULL` },
    createdAt: { label: "تاریخ ایجاد", type: "DATE", expression: ({ entity }) => `${entity}.created_at::date` },
  },
  CONTACT: {
    name: { label: "نام فرد رابط", type: "TEXT", expression: ({ entity }) => `${entity}.name` },
    role: { label: "سمت", type: "TEXT", expression: ({ entity }) => `${entity}.role` },
    organizationName: { label: "نام سازمان", type: "TEXT", expression: ({ organization }) => `${organization ?? "o"}.name` },
    createdAt: { label: "تاریخ ایجاد", type: "DATE", expression: ({ entity }) => `${entity}.created_at::date` },
  },
  LEAD: {
    businessName: { label: "نام کسب‌وکار", type: "TEXT", expression: ({ entity }) => `${entity}.business_name` },
    city: { label: "شهر", type: "TEXT", expression: ({ entity }) => `${entity}.city` },
    status: { label: "وضعیت", type: "SELECT", expression: ({ entity }) => `${entity}.status`, options: ["NEW", "ATTEMPTING_CONTACT", "CONTACTED", "QUALIFIED", "NURTURING", "UNQUALIFIED", "CONVERTED"].map((value) => ({ value, label: value })) },
    source: { label: "منبع", type: "SELECT", expression: ({ entity }) => `${entity}.source`, options: ["OUTBOUND_CALL", "LANDING_FORM", "SEO", "INSTAGRAM", "REFERRAL", "SMS", "PARTNER", "MANUAL", "OTHER"].map((value) => ({ value, label: value })) },
    priority: { label: "اولویت", type: "SELECT", expression: ({ entity }) => `${entity}.priority`, options: ["LOW", "NORMAL", "HIGH"].map((value) => ({ value, label: value })) },
    createdAt: { label: "تاریخ ایجاد", type: "DATE", expression: ({ entity }) => `${entity}.created_at::date` },
  },
  DEAL: {
    title: { label: "عنوان فرصت", type: "TEXT", expression: ({ entity }) => `${entity}.title` },
    status: { label: "وضعیت", type: "SELECT", expression: ({ entity }) => `${entity}.status`, options: ["OPEN", "WON", "LOST"].map((value) => ({ value, label: value })) },
    stage: { label: "مرحله", type: "SELECT", expression: ({ entity }) => `${entity}.stage`, options: ["DISCOVERY", "DEMO_SCHEDULED", "DEMO_COMPLETED", "TRIAL_PROPOSED", "TRIAL_ACTIVE", "DECISION"].map((value) => ({ value, label: value })) },
    organizationName: { label: "نام سازمان", type: "TEXT", expression: ({ organization }) => `${organization ?? "o"}.name` },
    organizationCity: { label: "شهر", type: "TEXT", expression: ({ organization }) => `${organization ?? "o"}.city` },
    expectedCloseDate: { label: "تاریخ احتمالی بستن", type: "DATE", expression: ({ entity }) => `${entity}.expected_close_date` },
    estimatedAmountToman: { label: "برآورد ارزش (تومان)", type: "NUMBER", expression: ({ entity }) => `${entity}.estimated_amount_toman::numeric` },
    createdAt: { label: "تاریخ ایجاد", type: "DATE", expression: ({ entity }) => `${entity}.created_at::date` },
  },
};

const tagColumn: Record<CrmCustomFieldEntityType, string> = { ORGANIZATION: "organization_id", CONTACT: "contact_id", LEAD: "lead_id", DEAL: "deal_id" };

@Injectable()
export class CrmFilterService {
  constructor(private readonly dataSource: DataSource) {}

  async fields(entityType: CrmCustomFieldEntityType) {
    const result = Object.entries(core[entityType]).map(([key, field]) => ({ key, label: field.label, dataType: field.type, operators: operators[field.type], options: field.options ?? [] }));
    const tags = await this.dataSource.query<Row[]>("SELECT id AS value,name AS label FROM crm_tags WHERE active=TRUE AND archived_at IS NULL ORDER BY normalized_name,id");
    const definitions = await this.dataSource.query<Row[]>(`SELECT id,key,label,data_type AS "dataType" FROM crm_custom_field_definitions WHERE entity_type=$1 AND active=TRUE AND archived_at IS NULL ORDER BY sort_order,id`, [entityType]);
    const fields = definitions.map((field) => {
      const type = this.fieldType(field.dataType);
      const options = type === "SELECT" || type === "MULTI_SELECT" ? this.dataSource.query<Row[]>("SELECT id AS value,label FROM crm_custom_field_options WHERE field_definition_id=$1 AND active=TRUE AND archived_at IS NULL ORDER BY sort_order,id", [field.id]) : Promise.resolve([]);
      return { field, type, options };
    });
    const resolved = await Promise.all(fields.map(async ({ field, type, options }) => ({ key: `custom:${field.key}`, label: field.label, dataType: type, operators: operators[type], options: await options })));
    return [...result, { key: "tags", label: "برچسب‌ها", dataType: "MULTI_SELECT", operators: operators.MULTI_SELECT, options: tags }, ...resolved];
  }

  async compile(entityType: CrmCustomFieldEntityType, raw: unknown, values: unknown[], aliases: Aliases): Promise<string> {
    if (raw === undefined || raw === null || raw === "") return "";
    let input = raw;
    if (typeof raw === "string") {
      if (raw.length > 6000) throw new BadRequestException("Filter is too long");
      try { input = JSON.parse(raw); } catch { throw new BadRequestException("Filter must be valid JSON"); }
    }
    const filter = this.parse(input);
    if (!filter.conditions.length) return "";
    if (filter.conditions.length > 20) throw new BadRequestException("A filter can contain at most 20 conditions");
    const definitions = await this.dataSource.query<Row[]>("SELECT id,key,data_type FROM crm_custom_field_definitions WHERE entity_type=$1 AND active=TRUE AND archived_at IS NULL", [entityType]);
    const fields = new Map(definitions.map((field) => [field.key as string, field]));
    const clauses: string[] = [];
    for (const condition of filter.conditions) {
      if (!condition || typeof condition.field !== "string" || typeof condition.operator !== "string") throw new BadRequestException("Each filter condition needs a field and operator");
      if (Object.keys(condition as unknown as Record<string, unknown>).some((key) => !["field", "operator", "value"].includes(key))) throw new BadRequestException("Unknown filter condition property");
      if (condition.field === "tags") {
        clauses.push(await this.compileTags(entityType, aliases, condition, values));
        continue;
      }
      const customKey = condition.field.startsWith("custom:") ? condition.field.slice(7) : null;
      const custom = customKey ? fields.get(customKey) : null;
      const base = !customKey ? core[entityType][condition.field] : undefined;
      if (!custom && !base) throw new BadRequestException(`Unknown or inactive filter field: ${condition.field}`);
      const type: ValueType = custom ? this.fieldType(custom.data_type) : base!.type;
      if (!operators[type].includes(condition.operator)) throw new BadRequestException(`Operator ${condition.operator} is not valid for ${condition.field}`);
      if (custom && type === "MULTI_SELECT") clauses.push(await this.compileCustomMulti(aliases, customKey!, custom.id, condition, values));
      else {
        const expression = custom ? await this.customExpression(aliases, customKey!, type, values) : base!.expression(aliases);
        clauses.push(await this.compileScalar(expression, type, condition, values, custom?.id, base?.options?.map((option) => option.value)));
      }
    }
    return `(${clauses.join(filter.logic === "OR" ? " OR " : " AND ")})`;
  }

  async validateSort(entityType: CrmCustomFieldEntityType, sort: unknown): Promise<Record<string, string> | null> {
    if (sort == null) return null;
    if (!sort || typeof sort !== "object" || Array.isArray(sort)) throw new BadRequestException("Sort definition must be an object");
    const object = sort as Record<string, unknown>;
    const allowed: Record<CrmCustomFieldEntityType, string[]> = {
      ORGANIZATION: ["createdAt", "name", "city"], CONTACT: ["createdAt", "name"],
      LEAD: ["createdAt", "updatedAt", "status", "priority"], DEAL: ["title", "createdAt", "updatedAt", "expectedCloseDate", "estimatedAmountToman"],
    };
    if (Object.keys(object).some((key) => !["field", "direction"].includes(key)) || typeof object.field !== "string" || !allowed[entityType].includes(object.field) || !["ASC", "DESC"].includes(String(object.direction))) throw new BadRequestException("Unsupported sort definition");
    return { field: object.field, direction: String(object.direction) };
  }

  private parse(input: unknown): Filter {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("Filter must be an object");
    const object = input as Record<string, unknown>;
    if (Object.keys(object).some((key) => !["version", "logic", "conditions"].includes(key))) throw new BadRequestException("Unknown filter property");
    if (object.version !== 1 || !["AND", "OR"].includes(String(object.logic)) || !Array.isArray(object.conditions)) throw new BadRequestException("Unsupported filter format");
    if (object.conditions.length > 20) throw new BadRequestException("A filter can contain at most 20 conditions");
    return object as Filter;
  }

  private async compileTags(entityType: CrmCustomFieldEntityType, aliases: Aliases, condition: Condition, values: unknown[]) {
    if (!["containsAny", "containsAll", "containsNone", "isEmpty", "isNotEmpty"].includes(condition.operator)) throw new BadRequestException("Invalid tag filter operator");
    const column = tagColumn[entityType];
    const base = `SELECT 1 FROM crm_entity_tags et JOIN crm_tags t ON t.id=et.tag_id WHERE et.${column}=${aliases.entity}.id AND t.active=TRUE AND t.archived_at IS NULL`;
    if (condition.operator === "isEmpty") return `NOT EXISTS (${base})`;
    if (condition.operator === "isNotEmpty") return `EXISTS (${base})`;
    const ids = this.uuidArray(condition.value, "Tag filter");
    const active = await this.dataSource.query<Row[]>("SELECT id FROM crm_tags WHERE id=ANY($1::uuid[]) AND active=TRUE AND archived_at IS NULL", [ids]);
    if (active.length !== ids.length) throw new BadRequestException("Tag filter contains an unknown or archived Tag");
    const index = this.add(values, ids);
    if (condition.operator === "containsAny") return `EXISTS (${base} AND et.tag_id=ANY($${index}::uuid[]))`;
    if (condition.operator === "containsNone") return `NOT EXISTS (${base} AND et.tag_id=ANY($${index}::uuid[]))`;
    return `(SELECT count(DISTINCT et.tag_id) FROM crm_entity_tags et JOIN crm_tags t ON t.id=et.tag_id WHERE et.${column}=${aliases.entity}.id AND t.active=TRUE AND t.archived_at IS NULL AND et.tag_id=ANY($${index}::uuid[]))=cardinality($${index}::uuid[])`;
  }

  private async compileCustomMulti(aliases: Aliases, key: string, fieldId: string, condition: Condition, values: unknown[]) {
    const expression = await this.customExpression(aliases, key, "MULTI_SELECT", values);
    if (condition.operator === "isEmpty") return `(${expression} IS NULL OR ${expression}='[]'::jsonb)`;
    if (condition.operator === "isNotEmpty") return `(${expression} IS NOT NULL AND ${expression}<>'[]'::jsonb)`;
    const ids = this.uuidArray(condition.value, `custom:${key}`);
    const valid = await this.dataSource.query<Row[]>("SELECT id FROM crm_custom_field_options WHERE id=ANY($1::uuid[]) AND field_definition_id=$2", [ids, fieldId]);
    if (valid.length !== ids.length) throw new BadRequestException(`Filter contains an option from another field: custom:${key}`);
    const index = this.add(values, condition.operator === "containsAll" ? JSON.stringify(ids) : ids);
    if (condition.operator === "containsAny") return `jsonb_exists_any(COALESCE(${expression},'[]'::jsonb),$${index}::text[])`;
    if (condition.operator === "containsNone") return `NOT jsonb_exists_any(COALESCE(${expression},'[]'::jsonb),$${index}::text[])`;
    return `COALESCE(${expression},'[]'::jsonb) @> $${index}::jsonb`;
  }

  private async customExpression(aliases: Aliases, key: string, type: ValueType, values: unknown[]) {
    const index = this.add(values, key);
    if (type === "MULTI_SELECT") return `(${aliases.entity}.custom_fields -> $${index})`;
    const raw = `(${aliases.entity}.custom_fields ->> $${index})`;
    if (type === "NUMBER") return `NULLIF(${raw},'')::numeric`;
    if (type === "DATE") return `NULLIF(${raw},'')::date`;
    if (type === "BOOLEAN") return `(${raw}='true')`;
    return raw;
  }

  private async compileScalar(expression: string, type: ValueType, condition: Condition, values: unknown[], fieldId?: string, allowedValues?: string[]) {
    const operator = condition.operator;
    if (operator === "isEmpty") return type === "TEXT" || type === "SELECT" ? `(${expression} IS NULL OR ${expression}='')` : `(${expression} IS NULL)`;
    if (operator === "isNotEmpty") return type === "TEXT" || type === "SELECT" ? `(${expression} IS NOT NULL AND ${expression}<>'')` : `(${expression} IS NOT NULL)`;
    if (operator === "isTrue") return `(${expression})`;
    if (operator === "isFalse") return `(NOT (${expression}))`;
    if (operator === "between") {
      if (!Array.isArray(condition.value) || condition.value.length !== 2) throw new BadRequestException("Between filters need two values");
      const first = await this.validateScalar(type, condition.value[0], fieldId, allowedValues);
      const second = await this.validateScalar(type, condition.value[1], fieldId, allowedValues);
      const left = this.add(values, first); const right = this.add(values, second);
      return `(${expression} >= $${left} AND ${expression} <= $${right})`;
    }
    if (operator === "in") {
      if (!Array.isArray(condition.value) || condition.value.length < 1 || condition.value.length > 50) throw new BadRequestException("In filters need 1–50 values");
      const normalized = await Promise.all(condition.value.map((item) => this.validateScalar(type, item, fieldId, allowedValues)));
      const index = this.add(values, normalized);
      return `${expression}=ANY($${index}::${type === "NUMBER" ? "numeric" : "text"}[])`;
    }
    const value = await this.validateScalar(type, condition.value, fieldId, allowedValues);
    if (operator === "contains" || operator === "startsWith") {
      const pattern = operator === "contains" ? `%${escapeLike(String(value))}%` : `${escapeLike(String(value))}%`;
      const index = this.add(values, pattern);
      return `${expression} ILIKE $${index} ESCAPE '!'`;
    }
    const sqlOperator: Record<string, string> = { equals: "=", is: "=", notEquals: "<>", isNot: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", before: "<", after: ">" };
    const index = this.add(values, value);
    return `${expression} ${sqlOperator[operator]} $${index}${type === "NUMBER" ? "::numeric" : type === "DATE" ? "::date" : ""}`;
  }

  private async validateScalar(type: ValueType, value: unknown, fieldId?: string, allowedValues?: string[]): Promise<unknown> {
    if (type === "TEXT") {
      if (typeof value !== "string" || !value.trim() || value.length > 500) throw new BadRequestException("Text filters need a non-empty string");
      return value.trim();
    }
    if (type === "NUMBER") {
      const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
      if (!Number.isFinite(number) || Math.abs(number) > 1_000_000_000_000) throw new BadRequestException("Number filter value is invalid");
      return number;
    }
    if (type === "BOOLEAN") {
      if (typeof value !== "boolean") throw new BadRequestException("Boolean filter value must be true or false");
      return value;
    }
    if (type === "DATE") {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new BadRequestException("Date filters use YYYY-MM-DD");
      return value;
    }
    if (type === "SELECT") {
      if (typeof value !== "string" || value.length > 120) throw new BadRequestException("Select filter value is invalid");
      if (fieldId) {
        const rows = await this.dataSource.query<Row[]>("SELECT id FROM crm_custom_field_options WHERE id=$1 AND field_definition_id=$2", [value, fieldId]);
        if (!rows[0]) throw new BadRequestException("Select option is invalid for this field");
      } else if (!allowedValues?.includes(value)) throw new BadRequestException("Select filter value is not supported for this field");
      return value;
    }
    throw new BadRequestException("Unsupported filter value type");
  }

  private fieldType(type: CrmCustomFieldType | string): ValueType {
    if (type === CrmCustomFieldType.Number) return "NUMBER";
    if (type === CrmCustomFieldType.Boolean) return "BOOLEAN";
    if (type === CrmCustomFieldType.Date) return "DATE";
    if (type === CrmCustomFieldType.SingleSelect) return "SELECT";
    if (type === CrmCustomFieldType.MultiSelect) return "MULTI_SELECT";
    return "TEXT";
  }

  private uuidArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 50 || value.some((item) => typeof item !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item)) || new Set(value).size !== value.length) throw new BadRequestException(`${label} needs 1–50 unique IDs`);
    return value as string[];
  }

  private add(values: unknown[], value: unknown) { values.push(value); return values.length; }
}
