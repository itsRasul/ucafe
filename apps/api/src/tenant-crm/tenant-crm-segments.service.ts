import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { maskPhone } from "../auth/iran-phone.util";
import { CreateTenantCrmSegmentDto, TenantCrmSegmentListQueryDto, TenantCrmSegmentMembersQueryDto,
  UpdateTenantCrmSegmentDto } from "./dto/tenant-crm-segments.dto";

type Row = Record<string, any>;
type ValueType = "TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "ENUM" | "TAG" | "BIRTHDAY" | "MULTI_SELECT";
type Option = { value: string; label: string };
type Field = { key: string; label: string; dataType: ValueType; source: string; operators: string[]; options: Option[];
  sql?: string; customFieldId?: string; optionValues: Set<string> };
type Catalog = { fields: Field[]; byKey: Map<string, Field> };
type QueryExecutor = { query<T = any>(query: string, parameters?: any[]): Promise<T> };
type Condition = { type: "condition"; field: string; operator: string; value?: unknown };
type Group = { type: "group"; operator: "AND" | "OR"; conditions: Array<Group | Condition>; version?: number };
type Preset = { key: string; name: string; description: string; criteria: Group };

const operators: Record<ValueType, string[]> = {
  TEXT: ["equals", "contains", "starts_with", "is_empty", "is_not_empty"],
  NUMBER: ["equals", "greater_than", "greater_or_equal", "less_than", "less_or_equal", "between", "is_empty", "is_not_empty"],
  BOOLEAN: ["is_true", "is_false"],
  DATE: ["before", "after", "between", "within_last", "older_than", "this_month", "is_empty", "is_not_empty"],
  ENUM: ["equals", "in", "not_in", "is_empty", "is_not_empty"],
  TAG: ["has_tag", "does_not_have_tag"],
  BIRTHDAY: ["this_month", "is_empty", "is_not_empty"],
  MULTI_SELECT: ["contains_any", "contains_all", "contains_none", "is_empty", "is_not_empty"],
};

const core: Array<Omit<Field, "optionValues">> = [
  { key: "client.name", label: "نام مشتری", dataType: "TEXT", source: "client", operators: operators.TEXT, options: [],
    sql: "concat_ws(' ',c.first_name,c.last_name)" },
  { key: "client.status", label: "وضعیت مشتری", dataType: "ENUM", source: "client", operators: operators.ENUM,
    options: [{ value: "ACTIVE", label: "فعال" }, { value: "BLOCKED", label: "مسدود" }], sql: "c.status::text" },
  { key: "client.hasPhone", label: "دارای شماره تماس", dataType: "BOOLEAN", source: "client", operators: operators.BOOLEAN, options: [],
    sql: "NULLIF(BTRIM(c.phone),'') IS NOT NULL" },
  { key: "client.createdAt", label: "تاریخ عضویت", dataType: "DATE", source: "client", operators: operators.DATE, options: [],
    sql: "(c.created_at AT TIME ZONE $2)::date" },
  { key: "crm.preferredSeating", label: "جای نشستن دلخواه", dataType: "TEXT", source: "crm", operators: operators.TEXT, options: [], sql: "p.preferred_seating" },
  { key: "crm.favoriteDrink", label: "نوشیدنی محبوب", dataType: "TEXT", source: "crm", operators: operators.TEXT, options: [], sql: "p.favorite_drink" },
  { key: "crm.birthdayMonthDay", label: "ماه تولد", dataType: "BIRTHDAY", source: "crm", operators: operators.BIRTHDAY, options: [], sql: "p.birthday_month_day" },
  { key: "order.trackedCount", label: "تعداد کل سفارش‌ها", dataType: "NUMBER", source: "orders", operators: operators.NUMBER, options: [],
    sql: "(SELECT COUNT(*)::numeric FROM orders o WHERE o.coffee_shop_id=c.coffee_shop_id AND o.client_id=c.id)" },
  { key: "order.deliveredCount", label: "تعداد سفارش‌های تحویل‌شده", dataType: "NUMBER", source: "orders", operators: operators.NUMBER, options: [],
    sql: "(SELECT COUNT(*)::numeric FROM orders o WHERE o.coffee_shop_id=c.coffee_shop_id AND o.client_id=c.id AND o.status='DELIVERED')" },
  { key: "order.canceledCount", label: "تعداد سفارش‌های لغوشده", dataType: "NUMBER", source: "orders", operators: operators.NUMBER, options: [],
    sql: "(SELECT COUNT(*)::numeric FROM orders o WHERE o.coffee_shop_id=c.coffee_shop_id AND o.client_id=c.id AND o.status='CANCELED')" },
  { key: "order.knownSpendToman", label: "مبلغ شناخته‌شده یوکافه (تومان)", dataType: "NUMBER", source: "orders", operators: operators.NUMBER, options: [],
    sql: "(SELECT COALESCE(SUM(o.total_amount_toman),0)::numeric FROM orders o WHERE o.coffee_shop_id=c.coffee_shop_id AND o.client_id=c.id AND o.status='DELIVERED')" },
  { key: "order.averageDeliveredValueToman", label: "میانگین مبلغ سفارش تحویل‌شده (تومان)", dataType: "NUMBER", source: "orders", operators: operators.NUMBER, options: [],
    sql: "(SELECT ROUND(COALESCE(SUM(o.total_amount_toman) FILTER (WHERE o.status='DELIVERED'),0)::numeric / NULLIF(COUNT(*) FILTER (WHERE o.status='DELIVERED'),0))::numeric FROM orders o WHERE o.coffee_shop_id=c.coffee_shop_id AND o.client_id=c.id)" },
  { key: "order.firstOrderAt", label: "تاریخ اولین سفارش", dataType: "DATE", source: "orders", operators: operators.DATE, options: [],
    sql: "(SELECT MIN(o.created_at AT TIME ZONE $2)::date FROM orders o WHERE o.coffee_shop_id=c.coffee_shop_id AND o.client_id=c.id)" },
  { key: "order.lastOrderAt", label: "تاریخ آخرین سفارش", dataType: "DATE", source: "orders", operators: operators.DATE, options: [],
    sql: "(SELECT MAX(o.created_at AT TIME ZONE $2)::date FROM orders o WHERE o.coffee_shop_id=c.coffee_shop_id AND o.client_id=c.id)" },
  { key: "order.lastDeliveredAt", label: "تاریخ آخرین سفارش تحویل‌شده", dataType: "DATE", source: "orders", operators: operators.DATE, options: [],
    sql: "(SELECT MAX(COALESCE(o.status_changed_at,o.created_at) AT TIME ZONE $2)::date FROM orders o WHERE o.coffee_shop_id=c.coffee_shop_id AND o.client_id=c.id AND o.status='DELIVERED')" },
  { key: "reservation.totalCount", label: "تعداد کل رزروها", dataType: "NUMBER", source: "reservations", operators: operators.NUMBER, options: [],
    sql: "(SELECT COUNT(*)::numeric FROM reservations r WHERE r.coffee_shop_id=c.coffee_shop_id AND r.client_id=c.id)" },
  { key: "reservation.completedCount", label: "تعداد رزروهای انجام‌شده", dataType: "NUMBER", source: "reservations", operators: operators.NUMBER, options: [],
    sql: "(SELECT COUNT(*)::numeric FROM reservations r WHERE r.coffee_shop_id=c.coffee_shop_id AND r.client_id=c.id AND r.status='COMPLETED')" },
  { key: "reservation.canceledCount", label: "تعداد رزروهای لغوشده", dataType: "NUMBER", source: "reservations", operators: operators.NUMBER, options: [],
    sql: "(SELECT COUNT(*)::numeric FROM reservations r WHERE r.coffee_shop_id=c.coffee_shop_id AND r.client_id=c.id AND r.status='CANCELED')" },
  { key: "reservation.rejectedCount", label: "تعداد رزروهای ردشده", dataType: "NUMBER", source: "reservations", operators: operators.NUMBER, options: [],
    sql: "(SELECT COUNT(*)::numeric FROM reservations r WHERE r.coffee_shop_id=c.coffee_shop_id AND r.client_id=c.id AND r.status='REJECTED')" },
  { key: "reservation.noShowCount", label: "تعداد عدم‌حضور در رزرو", dataType: "NUMBER", source: "reservations", operators: operators.NUMBER, options: [],
    sql: "(SELECT COUNT(*)::numeric FROM reservations r WHERE r.coffee_shop_id=c.coffee_shop_id AND r.client_id=c.id AND r.status='NO_SHOW')" },
  { key: "reservation.lastReservationAt", label: "تاریخ آخرین رزرو", dataType: "DATE", source: "reservations", operators: operators.DATE, options: [],
    sql: "(SELECT MAX(r.created_at AT TIME ZONE $2)::date FROM reservations r WHERE r.coffee_shop_id=c.coffee_shop_id AND r.client_id=c.id)" },
  { key: "reservation.lastCompletedAt", label: "تاریخ آخرین رزرو انجام‌شده", dataType: "DATE", source: "reservations", operators: operators.DATE, options: [],
    sql: "(SELECT MAX(COALESCE(r.status_changed_at,r.created_at) AT TIME ZONE $2)::date FROM reservations r WHERE r.coffee_shop_id=c.coffee_shop_id AND r.client_id=c.id AND r.status='COMPLETED')" },
];

const group = (operator: "AND" | "OR", conditions: Array<Group | Condition>, version?: number): Group =>
  ({ type: "group", operator, conditions, ...(version ? { version } : {}) });
const condition = (field: string, operator: string, value?: unknown): Condition =>
  ({ type: "condition", field, operator, ...(value === undefined ? {} : { value }) });

const presets: Preset[] = [
  { key: "no-delivered-orders", name: "مشتریانی که هنوز سفارشی تحویل نگرفته‌اند", description: "تعداد سفارش‌های تحویل‌شده برابر صفر است.",
    criteria: group("AND", [condition("order.deliveredCount", "equals", 0)], 1) },
  { key: "repeat-customers", name: "مشتریان تکراری", description: "حداقل دو سفارش تحویل‌شده دارند.",
    criteria: group("AND", [condition("order.deliveredCount", "greater_or_equal", 2)], 1) },
  { key: "customers-with-no-shows", name: "مشتریان دارای عدم‌حضور", description: "حداقل یک رزرو با وضعیت صریح عدم‌حضور دارند.",
    criteria: group("AND", [condition("reservation.noShowCount", "greater_or_equal", 1)], 1) },
  { key: "birthdays-this-month", name: "تولدهای این ماه", description: "ماه تولد ثبت‌شده با ماه جاری در منطقه زمانی کافه برابر است.",
    criteria: group("AND", [condition("crm.birthdayMonthDay", "this_month")], 1) },
  { key: "lapsed-customers", name: "مشتریان بازگشت‌نکرده", description: "حداقل یک سفارش تحویل‌شده دارند و آخرین تحویل آن‌ها دست‌کم ۴۵ روز قبل بوده است.",
    criteria: group("AND", [condition("order.deliveredCount", "greater_or_equal", 1), condition("order.lastDeliveredAt", "older_than", 45)], 1) },
];

@Injectable()
export class TenantCrmSegmentsService {
  constructor(private readonly dataSource: DataSource) {}

  async fields(coffeeShopId: string) {
    const catalog = await this.catalog(coffeeShopId);
    return catalog.fields.map(({ optionValues: _optionValues, sql: _sql, customFieldId: _customFieldId, ...field }) => field);
  }

  async list(coffeeShopId: string, timeZone: string, query: TenantCrmSegmentListQueryDto) {
    const values: unknown[] = [coffeeShopId];
    const where = ["coffee_shop_id=$1"];
    if (query.q?.trim()) {
      values.push(query.q.trim());
      where.push(`strpos(lower(name),lower($${values.length}::text))>0`);
    }
    const [count] = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*)::text AS total FROM tenant_crm_segments WHERE ${where.join(" AND ")}`, values);
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await this.dataSource.query<Array<Row>>(`SELECT id,name,description,criteria,is_active AS "isActive",
      created_at AS "createdAt",updated_at AS "updatedAt" FROM tenant_crm_segments
      WHERE ${where.join(" AND ")} ORDER BY updated_at DESC,id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    const catalog = await this.catalog(coffeeShopId);
    const items = rows.map((row) => {
      const criteria = this.parseStoredCriteria(row.criteria);
      const issue = this.criteriaIssue(criteria, coffeeShopId, timeZone, catalog);
      return { ...row, criteria, criteriaValid: !issue, ...(issue ? { criteriaIssue: issue } : {}) };
    });
    return { items, total: Number(count?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async get(coffeeShopId: string, timeZone: string, segmentId: string) {
    const row = await this.segmentRow(coffeeShopId, segmentId);
    const criteria = this.parseStoredCriteria(row.criteria);
    const issue = this.criteriaIssue(criteria, coffeeShopId, timeZone, await this.catalog(coffeeShopId));
    return { ...row, isActive: Boolean(row.isActive), criteria, criteriaValid: !issue, ...(issue ? { criteriaIssue: issue } : {}) };
  }

  async create(coffeeShopId: string, timeZone: string, actorId: string, input: CreateTenantCrmSegmentDto) {
    const name = input.name.trim();
    const description = input.description?.trim() || null;
    this.compileCriteria(input.criteria, coffeeShopId, timeZone, await this.catalog(coffeeShopId));
    try {
      const rows = await this.dataSource.query<Array<{ id: string }>>(`INSERT INTO tenant_crm_segments
        (coffee_shop_id,name,description,criteria,created_by_user_id) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id`,
      [coffeeShopId, name, description, JSON.stringify(input.criteria), actorId]);
      return this.get(coffeeShopId, timeZone, rows[0]!.id);
    } catch (error) { this.throwConflict(error); }
  }

  async update(coffeeShopId: string, timeZone: string, segmentId: string, input: UpdateTenantCrmSegmentDto) {
    const current = await this.segmentRow(coffeeShopId, segmentId);
    const criteria = input.criteria === undefined ? this.parseStoredCriteria(current.criteria) : input.criteria;
    if (input.criteria !== undefined) this.compileCriteria(criteria, coffeeShopId, timeZone, await this.catalog(coffeeShopId));
    try {
      await this.dataSource.query(`UPDATE tenant_crm_segments SET name=COALESCE($3,name),
        description=CASE WHEN $4::boolean THEN $5 ELSE description END,
        criteria=$6::jsonb,is_active=COALESCE($7,is_active),updated_at=now()
        WHERE coffee_shop_id=$1 AND id=$2`,
      [coffeeShopId, segmentId, input.name?.trim() || null, input.description !== undefined,
        input.description == null ? null : input.description.trim() || null, JSON.stringify(criteria), input.isActive ?? null]);
      return this.get(coffeeShopId, timeZone, segmentId);
    } catch (error) { this.throwConflict(error); }
  }

  async preview(coffeeShopId: string, timeZone: string, criteria: unknown) {
    const catalog = await this.catalog(coffeeShopId);
    const compiled = this.compileCriteria(criteria, coffeeShopId, timeZone, catalog);
    const [count] = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*)::text AS total ${this.fromSql()} WHERE c.coffee_shop_id=$1 AND ${compiled.where}`, compiled.parameters);
    const samples = await this.dataSource.query<Array<Row>>(
      `SELECT c.id,c.first_name AS "firstName",c.last_name AS "lastName",c.phone,c.status,c.created_at AS "createdAt"
       ${this.fromSql()} WHERE c.coffee_shop_id=$1 AND ${compiled.where} ORDER BY c.created_at DESC,c.id DESC LIMIT 5`,
      compiled.parameters);
    return { matchingClients: Number(count?.total ?? 0), sample: this.projectClients(samples) };
  }

  async members(coffeeShopId: string, timeZone: string, criteria: unknown, query: TenantCrmSegmentMembersQueryDto) {
    const compiled = this.compileCriteria(criteria, coffeeShopId, timeZone, await this.catalog(coffeeShopId));
    const [count] = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*)::text AS total ${this.fromSql()} WHERE c.coffee_shop_id=$1 AND ${compiled.where}`, compiled.parameters);
    const values = [...compiled.parameters, query.pageSize, (query.page - 1) * query.pageSize];
    const rows = await this.dataSource.query<Array<Row>>(
      `SELECT c.id,c.first_name AS "firstName",c.last_name AS "lastName",c.phone,c.status,c.created_at AS "createdAt"
       ${this.fromSql()} WHERE c.coffee_shop_id=$1 AND ${compiled.where} ORDER BY c.created_at DESC,c.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { items: this.projectClients(rows), total: Number(count?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async segmentPreview(coffeeShopId: string, timeZone: string, segmentId: string) {
    const row = await this.segmentRow(coffeeShopId, segmentId);
    return this.preview(coffeeShopId, timeZone, this.parseStoredCriteria(row.criteria));
  }

  async segmentMembers(coffeeShopId: string, timeZone: string, segmentId: string, query: TenantCrmSegmentMembersQueryDto) {
    const row = await this.segmentRow(coffeeShopId, segmentId);
    return this.members(coffeeShopId, timeZone, this.parseStoredCriteria(row.criteria), query);
  }

  async audienceQuery(manager: EntityManager, coffeeShopId: string, timeZone: string, segmentId: string) {
    const [row] = await manager.query<Array<Row>>(`SELECT id,name,criteria,is_active AS "isActive" FROM tenant_crm_segments
      WHERE coffee_shop_id=$1 AND id=$2 FOR SHARE`, [coffeeShopId, segmentId]);
    if (!row) throw new NotFoundException("Segment not found");
    if (!row.isActive) throw new BadRequestException("Offer audience Segment must be active");
    const criteria = this.parseStoredCriteria(row.criteria);
    const compiled = this.compileCriteria(criteria, coffeeShopId, timeZone, await this.catalog(coffeeShopId, manager));
    return {
      sql: `SELECT c.id ${this.fromSql()} WHERE c.coffee_shop_id=$1 AND ${compiled.where}`,
      parameters: compiled.parameters,
      segmentName: row.name,
      criteria,
    };
  }

  listSmartGroups(): Array<{ key: string; name: string; description: string; criteria: unknown }> {
    return presets.map(({ key, name, description, criteria }) => ({ key, name, description, criteria }));
  }

  async smartGroupPreview(coffeeShopId: string, timeZone: string, key: string) {
    return this.preview(coffeeShopId, timeZone, this.smartGroup(key).criteria);
  }

  async smartGroupMembers(coffeeShopId: string, timeZone: string, key: string, query: TenantCrmSegmentMembersQueryDto) {
    return this.members(coffeeShopId, timeZone, this.smartGroup(key).criteria, query);
  }

  private async segmentRow(coffeeShopId: string, segmentId: string, executor: QueryExecutor = this.dataSource) {
    const rows = await executor.query<Array<Row>>(`SELECT id,name,description,criteria,is_active AS "isActive",
      created_by_user_id AS "createdByUserId",created_at AS "createdAt",updated_at AS "updatedAt"
      FROM tenant_crm_segments WHERE coffee_shop_id=$1 AND id=$2`, [coffeeShopId, segmentId]);
    if (!rows[0]) throw new NotFoundException("Segment not found");
    return rows[0];
  }

  private async catalog(coffeeShopId: string, executor: QueryExecutor = this.dataSource): Promise<Catalog> {
    const tags = await executor.query<Array<{ id: string; name: string }>>(
      `SELECT id,name FROM tenant_crm_tags WHERE coffee_shop_id=$1 AND archived_at IS NULL ORDER BY lower(name),id`, [coffeeShopId]);
    const definitions = await executor.query<Array<{ id: string; key: string; label: string; dataType: string }>>(
      `SELECT id,key,label,data_type AS "dataType" FROM tenant_crm_custom_field_definitions
       WHERE coffee_shop_id=$1 AND active=TRUE ORDER BY sort_order,id`, [coffeeShopId]);
    const optionRows = definitions.length ? await executor.query<Array<{ fieldDefinitionId: string; id: string; label: string }>>(
      `SELECT field_definition_id AS "fieldDefinitionId",id,label FROM tenant_crm_custom_field_options
       WHERE coffee_shop_id=$1 AND active=TRUE AND field_definition_id=ANY($2::uuid[]) ORDER BY sort_order,id`,
      [coffeeShopId, definitions.map((definition) => definition.id)]) : [];
    const optionsByField = new Map<string, Option[]>();
    for (const option of optionRows) {
      const options = optionsByField.get(option.fieldDefinitionId) ?? [];
      options.push({ value: option.id, label: option.label });
      optionsByField.set(option.fieldDefinitionId, options);
    }
    const fields: Field[] = core.map((field) => ({ ...field, optionValues: new Set(field.options.map((option) => option.value)) }));
    const tagOptions = tags.map((tag) => ({ value: tag.id, label: tag.name }));
    if (tagOptions.length) fields.push({ key: "tag", label: "برچسب", dataType: "TAG", source: "tags", operators: operators.TAG,
      options: tagOptions, optionValues: new Set(tagOptions.map((option) => option.value)) });
    for (const definition of definitions) {
      const dataType = this.customType(definition.dataType);
      if (!dataType) continue;
      const options = optionsByField.get(definition.id) ?? [];
      fields.push({ key: `custom.${definition.key}`, label: definition.label, dataType, source: "custom",
        operators: operators[dataType], options, optionValues: new Set(options.map((option) => option.value)), customFieldId: definition.id });
    }
    return { fields, byKey: new Map(fields.map((field) => [field.key, field])) };
  }

  private customType(type: string): ValueType | null {
    if (["TEXT", "LONG_TEXT", "URL"].includes(type)) return "TEXT";
    if (type === "NUMBER" || type === "BOOLEAN" || type === "DATE") return type;
    if (type === "SINGLE_SELECT") return "ENUM";
    if (type === "MULTI_SELECT") return "MULTI_SELECT";
    return null;
  }

  private criteriaIssue(criteria: unknown, coffeeShopId: string, timeZone: string, catalog: Catalog) {
    try { this.compileCriteria(criteria, coffeeShopId, timeZone, catalog); return null; }
    catch (error) { return error instanceof BadRequestException ? String(error.message) : "معیار این بخش‌بندی در دسترس نیست."; }
  }

  private compileCriteria(criteria: unknown, coffeeShopId: string, timeZone: string, catalog: Catalog) {
    if (JSON.stringify(criteria)?.length > 6000) throw new BadRequestException("Criteria is too large");
    const parameters: unknown[] = [coffeeShopId, timeZone];
    const state = { conditions: 0 };
    const where = this.compileGroup(criteria, 1, true, parameters, catalog, state);
    // Keep the tenant timezone parameter typed even when criteria use no date field.
    return { where: `$2::text IS NOT NULL AND ${where}`, parameters };
  }

  private compileGroup(input: unknown, depth: number, root: boolean, parameters: unknown[], catalog: Catalog,
    state: { conditions: number }): string {
    if (!this.isRecord(input) || input.type !== "group") throw new BadRequestException("Criteria groups must be objects");
    const allowed = root ? ["version", "type", "operator", "conditions"] : ["type", "operator", "conditions"];
    if (Object.keys(input).some((key) => !allowed.includes(key)) || root && input.version !== 1)
      throw new BadRequestException("Unsupported criteria format");
    if (depth > 3) throw new BadRequestException("Criteria can be nested at most three levels");
    if (input.operator !== "AND" && input.operator !== "OR") throw new BadRequestException("Group operator must be AND or OR");
    if (!Array.isArray(input.conditions) || input.conditions.length < 1 || input.conditions.length > 20)
      throw new BadRequestException("Each group must contain 1 to 20 rules");
    const clauses = input.conditions.map((child) => {
      if (this.isRecord(child) && child.type === "group") return this.compileGroup(child, depth + 1, false, parameters, catalog, state);
      state.conditions += 1;
      if (state.conditions > 20) throw new BadRequestException("A Segment can contain at most 20 conditions");
      return this.compileCondition(child, parameters, catalog);
    });
    return `(${clauses.join(input.operator === "OR" ? " OR " : " AND ")})`;
  }

  private compileCondition(input: unknown, parameters: unknown[], catalog: Catalog): string {
    if (!this.isRecord(input) || input.type !== "condition" ||
      Object.keys(input).some((key) => !["type", "field", "operator", "value"].includes(key)) ||
      typeof input.field !== "string" || typeof input.operator !== "string")
      throw new BadRequestException("Each rule needs a field and operator");
    const field = catalog.byKey.get(input.field);
    if (!field) throw new BadRequestException(`Unknown or inactive filter field: ${input.field}`);
    if (!field.operators.includes(input.operator)) throw new BadRequestException(`Operator is not valid for ${input.field}`);
    const value = this.validateValue(field, input.operator, input.value, Object.prototype.hasOwnProperty.call(input, "value"));
    if (field.dataType === "TAG") {
      const index = this.add(parameters, value);
      const relation = `tenant_crm_client_tags t WHERE t.coffee_shop_id=c.coffee_shop_id AND t.client_id=c.id AND t.tag_id=$${index}`;
      return input.operator === "has_tag" ? `EXISTS (SELECT 1 FROM ${relation})` : `NOT EXISTS (SELECT 1 FROM ${relation})`;
    }
    if (field.customFieldId) return this.compileCustom(field, input.operator, value, parameters);
    if (field.dataType === "BIRTHDAY") {
      if (input.operator === "this_month") return `substring(COALESCE(${field.sql},''),1,2)=to_char(now() AT TIME ZONE $2,'MM')`;
      return input.operator === "is_empty" ? `${field.sql} IS NULL` : `${field.sql} IS NOT NULL`;
    }
    return this.compileScalar(field.sql!, field.dataType, input.operator, value, parameters);
  }

  private validateValue(field: Field, operator: string, value: unknown, hasValue: boolean): unknown {
    const noValue = ["is_true", "is_false", "is_empty", "is_not_empty", "this_month"];
    if (noValue.includes(operator)) {
      if (hasValue) throw new BadRequestException("This rule must not include a value");
      return undefined;
    }
    if (!hasValue || value === null || value === undefined) throw new BadRequestException("This rule needs a value");
    if (field.dataType === "TEXT") {
      if (typeof value !== "string" || !value.trim() || value.length > 500) throw new BadRequestException("Text filter values must contain 1 to 500 characters");
      return value.trim();
    }
    if (field.dataType === "NUMBER") {
      if (operator === "between") {
        if (!Array.isArray(value) || value.length !== 2 || value.some((item) => !this.validNumber(item)) || value[0] > value[1])
          throw new BadRequestException("Number range must contain two ordered finite numbers");
        return value;
      }
      if (!this.validNumber(value)) throw new BadRequestException("Number filter value is invalid");
      return value;
    }
    if (field.dataType === "DATE") {
      if (operator === "within_last" || operator === "older_than") {
        if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 3650) throw new BadRequestException("Relative date range must be 1 to 3650 days");
        return value;
      }
      if (operator === "between") {
        if (!Array.isArray(value) || value.length !== 2 || !this.validDate(value[0]) || !this.validDate(value[1]) || value[0] > value[1])
          throw new BadRequestException("Date range must contain two ordered ISO dates");
        return value;
      }
      if (!this.validDate(value)) throw new BadRequestException("Date filter value must be a real ISO date");
      return value;
    }
    if (field.dataType === "ENUM" || field.dataType === "TAG") {
      if (operator === "in" || operator === "not_in") {
        const ids = this.stringArray(value);
        if (!ids.length || ids.length > 100 || ids.some((item) => !field.optionValues.has(item)))
          throw new BadRequestException("Selection contains an unknown or inactive option");
        return ids;
      }
      if (typeof value !== "string" || !field.optionValues.has(value)) throw new BadRequestException("Selection contains an unknown or inactive option");
      return value;
    }
    if (field.dataType === "MULTI_SELECT") {
      const ids = this.stringArray(value);
      if (!ids.length || ids.length > 100 || ids.some((item) => !field.optionValues.has(item)))
        throw new BadRequestException("Selection contains an unknown or inactive option");
      return ids;
    }
    throw new BadRequestException("This field does not accept values");
  }

  private compileScalar(sql: string, type: ValueType, operator: string, value: unknown, parameters: unknown[], dateAsText = false) {
    if (operator === "is_empty") return type === "TEXT" ? `NULLIF(BTRIM(${sql}),'') IS NULL` : `(${sql}) IS NULL`;
    if (operator === "is_not_empty") return type === "TEXT" ? `NULLIF(BTRIM(${sql}),'') IS NOT NULL` : `(${sql}) IS NOT NULL`;
    if (type === "TEXT") {
      const index = this.add(parameters, value);
      if (operator === "equals") return `lower(${sql})=lower($${index}::text)`;
      if (operator === "contains") return `strpos(lower(COALESCE(${sql},'')),lower($${index}::text))>0`;
      return `left(lower(COALESCE(${sql},'')),char_length($${index}::text))=lower($${index}::text)`;
    }
    if (type === "NUMBER") {
      if (operator === "between") {
        const lower = this.add(parameters, (value as unknown[])[0]);
        const upper = this.add(parameters, (value as unknown[])[1]);
        return `(${sql}) BETWEEN $${lower}::numeric AND $${upper}::numeric`;
      }
      const index = this.add(parameters, value);
      const symbol = ({ equals: "=", greater_than: ">", greater_or_equal: ">=", less_than: "<", less_or_equal: "<=" } as Record<string, string>)[operator]!;
      return `(${sql}) ${symbol} $${index}::numeric`;
    }
    if (type === "DATE") {
      const cast = dateAsText ? "text" : "date";
      if (operator === "this_month") {
        const start = "(date_trunc('month',now() AT TIME ZONE $2)::date)";
        const end = `(${start} + INTERVAL '1 month')::date`;
        return dateAsText
          ? `(${sql}) >= to_char(${start},'YYYY-MM-DD') AND (${sql}) < to_char(${end},'YYYY-MM-DD')`
          : `(${sql}) >= ${start} AND (${sql}) < ${end}`;
      }
      if (operator === "between") {
        const lower = this.add(parameters, (value as unknown[])[0]);
        const upper = this.add(parameters, (value as unknown[])[1]);
        return `(${sql}) BETWEEN $${lower}::${cast} AND $${upper}::${cast}`;
      }
      const index = this.add(parameters, value);
      if (operator === "within_last") return dateAsText
        ? `(${sql}) >= (((now() AT TIME ZONE $2)::date - ($${index}::int - 1))::text)`
        : `(${sql}) >= ((now() AT TIME ZONE $2)::date - ($${index}::int - 1))`;
      if (operator === "older_than") return dateAsText
        ? `(${sql}) < (((now() AT TIME ZONE $2)::date - $${index}::int)::text)`
        : `(${sql}) < ((now() AT TIME ZONE $2)::date - $${index}::int)`;
      return `(${sql}) ${operator === "before" ? "<" : ">"} $${index}::${cast}`;
    }
    if (type === "BOOLEAN") return `(${sql}) IS ${operator === "is_true" ? "TRUE" : "FALSE"}`;
    if (type === "ENUM") {
      if (operator === "in" || operator === "not_in") {
        const index = this.add(parameters, value);
        return operator === "in" ? `(${sql})=ANY($${index}::text[])` : `(${sql})<>ALL($${index}::text[])`;
      }
      const index = this.add(parameters, value);
      return `(${sql})=$${index}::text`;
    }
    throw new BadRequestException("Unsupported filter field");
  }

  private compileCustom(field: Field, operator: string, value: unknown, parameters: unknown[]) {
    const fieldId = this.add(parameters, field.customFieldId);
    const base = `tenant_crm_client_custom_field_values v WHERE v.coffee_shop_id=c.coffee_shop_id AND v.client_id=c.id AND v.field_definition_id=$${fieldId}`;
    const hasValue = field.dataType === "MULTI_SELECT" ? `jsonb_typeof(v.value)='array' AND v.value<>'[]'::jsonb`
      : field.dataType === "TEXT" ? `NULLIF(BTRIM(v.value #>> '{}'),'') IS NOT NULL` : "TRUE";
    if (operator === "is_empty") return `NOT EXISTS (SELECT 1 FROM ${base} AND ${hasValue})`;
    if (operator === "is_not_empty") return `EXISTS (SELECT 1 FROM ${base} AND ${hasValue})`;
    if (field.dataType === "MULTI_SELECT") {
      const index = this.add(parameters, operator === "contains_all" ? JSON.stringify(value) : value);
      const matches = operator === "contains_all" ? `v.value @> $${index}::jsonb` : `v.value ?| $${index}::text[]`;
      const predicate = operator === "contains_none" ? `NOT EXISTS (SELECT 1 FROM ${base} AND ${matches})` :
        `EXISTS (SELECT 1 FROM ${base} AND ${matches})`;
      return predicate;
    }
    const raw = "v.value #>> '{}'";
    const expression = field.dataType === "NUMBER" ? `CASE WHEN jsonb_typeof(v.value)='number' THEN (${raw})::numeric END`
      : field.dataType === "BOOLEAN" ? `CASE WHEN jsonb_typeof(v.value)='boolean' THEN (${raw})::boolean END` : raw;
    const clause = this.compileScalar(expression, field.dataType, operator, value, parameters, field.dataType === "DATE");
    return `EXISTS (SELECT 1 FROM ${base} AND ${clause})`;
  }

  private fromSql() {
    return "FROM clients c LEFT JOIN tenant_crm_client_profiles p ON p.coffee_shop_id=c.coffee_shop_id AND p.client_id=c.id";
  }

  private projectClients(rows: Row[]): Array<{ id: string; firstName: string; lastName: string; phone: string; status: string; createdAt: Date }> {
    return rows.map((row) => ({ id: row.id, firstName: row.firstName, lastName: row.lastName, phone: maskPhone(String(row.phone)),
      status: row.status, createdAt: row.createdAt }));
  }

  private parseStoredCriteria(value: unknown) {
    if (typeof value === "string") {
      try { return JSON.parse(value) as unknown; } catch { return value; }
    }
    return value;
  }

  private smartGroup(key: string) {
    const preset = presets.find((group) => group.key === key);
    if (!preset) throw new NotFoundException("Smart Group not found");
    return preset;
  }

  private add(parameters: unknown[], value: unknown) { parameters.push(value); return parameters.length; }
  private isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
  private validNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000_000; }
  private validDate(value: unknown) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  private stringArray(value: unknown): string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string") && new Set(value).size === value.length ? value : [];
  }

  private throwConflict(error: unknown): never {
    const constraint = (error as { driverError?: { constraint?: string } })?.driverError?.constraint;
    if (constraint === "UQ_tenant_crm_segments_name") throw new ConflictException({ code: "TENANT_CRM_SEGMENT_NAME_IN_USE", message: "بخش‌بندی‌ای با این نام وجود دارد." });
    throw error;
  }
}
