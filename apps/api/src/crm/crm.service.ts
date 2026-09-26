import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import {
  ContactDuplicateQueryDto,
  CreateContactDto,
  CreateOrganizationDto,
  CrmContactListQueryDto,
  CrmListQueryDto,
  OrganizationDuplicateQueryDto,
  UpdateContactDto,
  UpdateOrganizationDto,
} from "./dto/crm.dto";
import { escapeLike, normalizeContactEmail, normalizeContactPhone, normalizeCrmComparable, normalizeCrmName, normalizeInstagramHandle, normalizeCrmWebsite } from "./crm-normalization.util";

type DbRow = Record<string, any>;
type ArchiveStatus = "ACTIVE" | "ARCHIVED" | "ALL";

@Injectable()
export class CrmService {
  constructor(private readonly dataSource: DataSource, private readonly crypto: AuthCryptoService) {}

  async listOrganizations(query: CrmListQueryDto) {
    const where: string[] = [];
    const values: unknown[] = [];
    this.addArchiveFilter(where, values, "o", query.archiveStatus);
    if (query.q) {
      values.push(`%${escapeLike(query.q)}%`);
      where.push(`(o.name ILIKE $${values.length} ESCAPE '!' OR COALESCE(o.city, '') ILIKE $${values.length} ESCAPE '!' OR COALESCE(o.website, '') ILIKE $${values.length} ESCAPE '!' OR COALESCE(o.instagram_handle, '') ILIKE $${values.length} ESCAPE '!')`);
    }
    if (query.city) { values.push(normalizeCrmComparable(query.city)); where.push(`o.city_normalized = $${values.length}`); }
    if (query.coffeeShopId) { values.push(query.coffeeShopId); where.push(`o.coffee_shop_id = $${values.length}`); }
    if (query.tenantLink === "LINKED") where.push("o.coffee_shop_id IS NOT NULL");
    if (query.tenantLink === "UNLINKED") where.push("o.coffee_shop_id IS NULL");
    const predicate = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const counts = await this.dataSource.query<Array<{ total: string }>>(`SELECT count(*)::text AS total FROM crm_organizations o ${predicate}`, values);
    const sort = { createdAt: "o.created_at", name: "o.name_normalized", city: "o.city_normalized" }[query.sort];
    const pageValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
    const items = await this.dataSource.query<DbRow[]>(`
      SELECT o.id, o.name, o.city, o.website, o.instagram_handle AS "instagram", o.coffee_shop_id AS "coffeeShopId",
        s.name AS "tenantName", s.status AS "tenantStatus", o.archived_at AS "archivedAt",
        o.created_at AS "createdAt", o.updated_at AS "updatedAt",
        (SELECT count(*)::int FROM crm_contacts c WHERE c.organization_id = o.id AND c.archived_at IS NULL) AS "contactCount"
      FROM crm_organizations o
      LEFT JOIN coffee_shops s ON s.id = o.coffee_shop_id
      ${predicate}
      ORDER BY ${sort} ${query.direction}, o.id ASC
      LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}
    `, pageValues);
    return { items, total: Number(counts[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async listTenantLinkCandidates(organizationId?: string) {
    // ponytail: cap the initial selector at 100; add search or pagination if Tenants outgrow it.
    return this.dataSource.query<DbRow[]>(`
      SELECT s.id, s.name, s.slug, s.status, d.hostname
      FROM coffee_shops s LEFT JOIN domains d ON d.coffee_shop_id=s.id AND d.is_primary=TRUE
        AND d.status='ACTIVE' AND d.deleted_at IS NULL
      LEFT JOIN crm_organizations linked ON linked.coffee_shop_id=s.id
      WHERE s.deleted_at IS NULL AND (linked.id IS NULL OR linked.id=$1)
      ORDER BY s.name, s.id
      LIMIT 100
    `, [organizationId ?? null]);
  }

  async linkOrganizationTenant(id: string, coffeeShopId: string, actorId: string) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const tenants = await manager.query<Array<{ id: string }>>(
          "SELECT id FROM coffee_shops WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [coffeeShopId],
        );
        if (!tenants[0]) throw new NotFoundException("Tenant not found");
        const current = await this.findOrganization(manager, id, true);
        if (!current) throw new NotFoundException("CRM organization not found");
        if (current.archived_at) throw new ConflictException("Restore this organization before linking a Tenant");
        if (current.coffee_shop_id === coffeeShopId) return this.organizationProjection(current);
        if (current.coffee_shop_id) throw new ConflictException("Unlink the current Tenant before linking another");
        await manager.query("UPDATE crm_organizations SET coffee_shop_id=$2,updated_by_user_id=$3,updated_at=now() WHERE id=$1", [id, coffeeShopId, actorId]);
        await this.auditWithSummary(manager, actorId, "crm.organization.tenant_linked", id, { coffeeShopId });
        return this.organizationProjection((await this.findOrganization(manager, id))!);
      });
    } catch (error) { this.rethrowDatabaseConflict(error); }
  }

  async unlinkOrganizationTenant(id: string, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.findOrganization(manager, id, true);
      if (!current) throw new NotFoundException("CRM organization not found");
      if (!current.coffee_shop_id) return this.organizationProjection(current);
      const coffeeShopId = current.coffee_shop_id as string;
      await manager.query("UPDATE crm_organizations SET coffee_shop_id=NULL,updated_by_user_id=$2,updated_at=now() WHERE id=$1", [id, actorId]);
      await this.auditWithSummary(manager, actorId, "crm.organization.tenant_unlinked", id, { coffeeShopId });
      return this.organizationProjection((await this.findOrganization(manager, id))!);
    });
  }

  async organizationDuplicateCandidates(input: OrganizationDuplicateQueryDto) {
    const match: string[] = [];
    const matchingFields: string[] = [];
    const values: unknown[] = [];
    const name = input.name?.trim() ? normalizeCrmComparable(input.name) : null;
    const city = input.city?.trim() ? normalizeCrmComparable(input.city) : null;
    const website = this.normalizeWebsite(input.website);
    const instagram = this.normalizeInstagram(input.instagram);
    if (name && city) {
      values.push(name, city);
      const nameIndex = values.length - 1;
      const cityIndex = values.length;
      match.push(`(o.name_normalized = $${nameIndex} AND o.city_normalized = $${cityIndex})`);
      matchingFields.push(`CASE WHEN o.name_normalized = $${nameIndex} AND o.city_normalized = $${cityIndex} THEN 'name_city' END`);
    }
    if (website.host) {
      values.push(website.host);
      match.push(`o.website_host = $${values.length}`);
      matchingFields.push(`CASE WHEN o.website_host = $${values.length} THEN 'website' END`);
    }
    if (instagram) {
      values.push(instagram);
      match.push(`o.instagram_handle = $${values.length}`);
      matchingFields.push(`CASE WHEN o.instagram_handle = $${values.length} THEN 'instagram' END`);
    }
    if (!match.length) return [];
    let exclude = "";
    if (input.excludeId) { values.push(input.excludeId); exclude = `AND o.id <> $${values.length}`; }
    return this.dataSource.query<DbRow[]>(`
      SELECT o.id, o.name, o.city, o.website, o.instagram_handle AS "instagram", o.archived_at AS "archivedAt",
        array_remove(ARRAY[${matchingFields.join(", ")}], NULL) AS "matchingFields"
      FROM crm_organizations o
      WHERE (${match.join(" OR ")}) ${exclude}
      ORDER BY (o.archived_at IS NULL) DESC, o.name_normalized
      LIMIT 20
    `, values);
  }

  async getOrganization(id: string) {
    const row = await this.findOrganization(this.dataSource, id);
    if (!row) throw new NotFoundException("CRM organization not found");
    return this.organizationProjection(row);
  }

  async createOrganization(input: CreateOrganizationDto, actorId: string) {
    const normalized = this.organizationValues(input);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const rows = await manager.query<DbRow[]>(`
          INSERT INTO crm_organizations (name, name_normalized, city, city_normalized, website, website_host, instagram_handle, created_by_user_id, updated_by_user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
          RETURNING id
        `, [normalized.name, normalized.nameNormalized, normalized.city, normalized.cityNormalized, normalized.website, normalized.websiteHost, normalized.instagram, actorId]);
        const id = rows[0]!.id as string;
        await this.audit(manager, actorId, "crm.organization.created", "crm_organization", id);
        return this.organizationProjection((await this.findOrganization(manager, id))!);
      });
    } catch (error) { this.rethrowDatabaseConflict(error); }
  }

  async updateOrganization(id: string, input: UpdateOrganizationDto, actorId: string) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const current = await this.findOrganization(manager, id, true);
        if (!current) throw new NotFoundException("CRM organization not found");
        if (current.archived_at) throw new ConflictException("Restore this organization before editing it");
        const patch = this.organizationValues({
          name: input.name ?? current.name,
          city: input.city === undefined ? current.city : input.city,
          website: input.website === undefined ? current.website : input.website,
          instagram: input.instagram === undefined ? current.instagram_handle : input.instagram,
        });
        await manager.query(`UPDATE crm_organizations SET name=$2, name_normalized=$3, city=$4, city_normalized=$5, website=$6, website_host=$7, instagram_handle=$8, updated_by_user_id=$9, updated_at=now() WHERE id=$1`, [id, patch.name, patch.nameNormalized, patch.city, patch.cityNormalized, patch.website, patch.websiteHost, patch.instagram, actorId]);
        await this.audit(manager, actorId, "crm.organization.updated", "crm_organization", id);
        return this.organizationProjection((await this.findOrganization(manager, id))!);
      });
    } catch (error) { this.rethrowDatabaseConflict(error); }
  }

  async archiveOrganization(id: string, actorId: string) { return this.setOrganizationArchived(id, actorId, true); }
  async restoreOrganization(id: string, actorId: string) { return this.setOrganizationArchived(id, actorId, false); }

  private async setOrganizationArchived(id: string, actorId: string, archive: boolean) {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.findOrganization(manager, id, true);
      if (!current) throw new NotFoundException("CRM organization not found");
      if (Boolean(current.archived_at) === archive) return this.organizationProjection(current);
      await manager.query("UPDATE crm_organizations SET archived_at=$2, updated_by_user_id=$3, updated_at=now() WHERE id=$1", [id, archive ? new Date() : null, actorId]);
      await this.audit(manager, actorId, archive ? "crm.organization.archived" : "crm.organization.restored", "crm_organization", id);
      return this.organizationProjection((await this.findOrganization(manager, id))!);
    });
  }

  async listContacts(query: CrmContactListQueryDto) {
    const where: string[] = [];
    const values: unknown[] = [];
    this.addArchiveFilter(where, values, "c", query.archiveStatus);
    if (query.organizationId) { values.push(query.organizationId); where.push(`c.organization_id = $${values.length}`); }
    if (query.q) {
      const q = query.q.trim();
      const escaped = `%${escapeLike(q)}%`;
      values.push(escaped);
      const textIndex = values.length;
      let identifiers: string[] = [];
      if (q.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) identifiers.push(`c.email_hash = $${this.addValue(values, this.crypto.hashEmail(normalizeContactEmail(q)!))}`);
      if (/^[+۰-۹٠-٩0-9\s()-]+$/.test(q) && (q.match(/[0-9۰-۹٠-٩]/g)?.length ?? 0) >= 7) {
        try { identifiers.push(`c.phone_hash = $${this.addValue(values, this.crypto.hashPhone(normalizeContactPhone(q)!))}`); } catch { /* partial number searches remain name/role searches */ }
      }
      where.push(`(c.name ILIKE $${textIndex} ESCAPE '!' OR COALESCE(c.role, '') ILIKE $${textIndex} ESCAPE '!'${identifiers.length ? ` OR ${identifiers.join(" OR ")}` : ""})`);
    }
    const predicate = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const counts = await this.dataSource.query<Array<{ total: string }>>(`SELECT count(*)::text AS total FROM crm_contacts c ${predicate}`, values);
    const sort = { createdAt: "c.created_at", name: "c.name", city: "o.city" }[query.sort];
    const pageValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
    const items = await this.dataSource.query<DbRow[]>(`
      SELECT c.id, c.organization_id AS "organizationId", c.name, c.role, c.archived_at AS "archivedAt", c.created_at AS "createdAt", c.updated_at AS "updatedAt",
        o.name AS "organizationName", o.city AS "organizationCity"
      FROM crm_contacts c JOIN crm_organizations o ON o.id = c.organization_id
      ${predicate}
      ORDER BY ${sort} ${query.direction}, c.id ASC
      LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}
    `, pageValues);
    return { items, total: Number(counts[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async contactDuplicateCandidates(organizationId: string, input: ContactDuplicateQueryDto) {
    const phone = this.normalizePhone(input.phone);
    const email = this.normalizeEmail(input.email);
    const phoneHash = phone ? this.crypto.hashPhone(phone) : null;
    const emailHash = email ? this.crypto.hashEmail(email) : null;
    if (!phoneHash && !emailHash) return [];
    const where = ["c.organization_id = $1", `(${[phoneHash ? "c.phone_hash = $2" : "", emailHash ? `c.email_hash = $${phoneHash ? 3 : 2}` : ""].filter(Boolean).join(" OR ")})`];
    const values: unknown[] = [organizationId];
    if (phoneHash) values.push(phoneHash);
    if (emailHash) values.push(emailHash);
    if (input.excludeId) { values.push(input.excludeId); where.push(`c.id <> $${values.length}`); }
    return this.dataSource.query<DbRow[]>(`
      SELECT c.id, c.name, c.role, c.archived_at AS "archivedAt",
        array_remove(ARRAY[
          CASE WHEN ${phoneHash ? `c.phone_hash = $2` : "FALSE"} THEN 'phone' END,
          CASE WHEN ${emailHash ? `c.email_hash = $${phoneHash ? 3 : 2}` : "FALSE"} THEN 'email' END
        ], NULL) AS "matchingFields"
      FROM crm_contacts c WHERE ${where.join(" AND ")}
      ORDER BY (c.archived_at IS NULL) DESC, c.name LIMIT 20
    `, values);
  }

  async getContact(id: string) {
    const row = await this.findContact(this.dataSource, id, true);
    if (!row) throw new NotFoundException("CRM contact not found");
    return this.contactProjection(row, true);
  }

  async createContact(organizationId: string, input: CreateContactDto, actorId: string) {
    const name = this.requireText(input.name, "Contact name");
    const role = this.optionalText(input.role);
    const phone = this.normalizePhone(input.phone);
    const email = this.normalizeEmail(input.email);
    return this.dataSource.transaction(async (manager) => {
      const organizations = await manager.query<Array<{ archived_at: Date | null }>>("SELECT archived_at FROM crm_organizations WHERE id=$1 FOR UPDATE", [organizationId]);
      if (!organizations[0]) throw new NotFoundException("CRM organization not found");
      if (organizations[0].archived_at) throw new ConflictException("Restore this organization before adding contacts");
      const rows = await manager.query<DbRow[]>(`
        INSERT INTO crm_contacts (organization_id, name, role, phone_encrypted, phone_hash, email_encrypted, email_hash, created_by_user_id, updated_by_user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id
      `, [organizationId, name, role, phone ? this.crypto.encryptPii(phone) : null, phone ? this.crypto.hashPhone(phone) : null, email ? this.crypto.encryptPii(email) : null, email ? this.crypto.hashEmail(email) : null, actorId]);
      const id = rows[0]!.id as string;
      await this.audit(manager, actorId, "crm.contact.created", "crm_contact", id);
      return this.contactProjection((await this.findContact(manager, id, true))!, true);
    });
  }

  async updateContact(id: string, input: UpdateContactDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.findContact(manager, id, true, true);
      if (!current) throw new NotFoundException("CRM contact not found");
      if (current.archived_at) throw new ConflictException("Restore this contact before editing it");
      if (current.organization_archived_at) throw new ConflictException("Restore this organization before editing its contacts");
      const name = input.name === undefined ? current.name : this.requireText(input.name, "Contact name");
      const role = input.role === undefined ? current.role : this.optionalText(input.role);
      const phone = input.phone === undefined ? (current.phone_encrypted ? this.crypto.decryptPii(current.phone_encrypted) : null) : this.normalizePhone(input.phone);
      const email = input.email === undefined ? (current.email_encrypted ? this.crypto.decryptPii(current.email_encrypted) : null) : this.normalizeEmail(input.email);
      await manager.query(`
        UPDATE crm_contacts SET name=$2, role=$3, phone_encrypted=$4, phone_hash=$5, email_encrypted=$6, email_hash=$7, updated_by_user_id=$8, updated_at=now()
        WHERE id=$1
      `, [id, name, role, phone ? this.crypto.encryptPii(phone) : null, phone ? this.crypto.hashPhone(phone) : null, email ? this.crypto.encryptPii(email) : null, email ? this.crypto.hashEmail(email) : null, actorId]);
      await this.audit(manager, actorId, "crm.contact.updated", "crm_contact", id);
      return this.contactProjection((await this.findContact(manager, id, true))!, true);
    });
  }

  async archiveContact(id: string, actorId: string) { return this.setContactArchived(id, actorId, true); }
  async restoreContact(id: string, actorId: string) { return this.setContactArchived(id, actorId, false); }

  private async setContactArchived(id: string, actorId: string, archive: boolean) {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.findContact(manager, id, true);
      if (!current) throw new NotFoundException("CRM contact not found");
      if (Boolean(current.archived_at) === archive) return this.contactProjection(current, true);
      await manager.query("UPDATE crm_contacts SET archived_at=$2, updated_by_user_id=$3, updated_at=now() WHERE id=$1", [id, archive ? new Date() : null, actorId]);
      await this.audit(manager, actorId, archive ? "crm.contact.archived" : "crm.contact.restored", "crm_contact", id);
      return this.contactProjection((await this.findContact(manager, id, true))!, true);
    });
  }

  private async findOrganization(manager: DataSource | EntityManager, id: string, lock = false): Promise<DbRow | null> {
    const rows = await manager.query<DbRow[]>(`
      SELECT o.*, o.instagram_handle AS instagram, s.name AS tenant_name, s.status AS tenant_status
      FROM crm_organizations o LEFT JOIN coffee_shops s ON s.id=o.coffee_shop_id
      WHERE o.id=$1 ${lock ? "FOR UPDATE OF o" : ""}
    `, [id]);
    return rows[0] ?? null;
  }

  private organizationProjection(row: DbRow) {
    return {
      id: row.id, name: row.name, city: row.city, website: row.website, instagram: row.instagram ?? row.instagram_handle,
      coffeeShopId: row.coffee_shop_id, tenant: row.coffee_shop_id ? { id: row.coffee_shop_id, name: row.tenant_name, status: row.tenant_status } : null,
      archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  private async findContact(manager: DataSource | EntityManager, id: string, includePii = false, lock = false): Promise<DbRow | null> {
    const pii = includePii ? ", c.phone_encrypted, c.email_encrypted, c.phone_hash, c.email_hash" : "";
    const rows = await manager.query<DbRow[]>(`
      SELECT c.id, c.organization_id, c.name, c.role, c.archived_at, c.created_at, c.updated_at${pii},
        o.name AS organization_name, o.archived_at AS organization_archived_at
      FROM crm_contacts c JOIN crm_organizations o ON o.id=c.organization_id
      WHERE c.id=$1 ${lock ? "FOR UPDATE OF c" : ""}
    `, [id]);
    return rows[0] ?? null;
  }

  private contactProjection(row: DbRow, includePii = false) {
    const result: DbRow = {
      id: row.id, organizationId: row.organization_id, organizationName: row.organization_name,
      name: row.name, role: row.role, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
    };
    if (includePii) {
      result.phone = row.phone_encrypted ? this.crypto.decryptPii(row.phone_encrypted) : null;
      result.email = row.email_encrypted ? this.crypto.decryptPii(row.email_encrypted) : null;
    }
    return result;
  }

  private organizationValues(input: CreateOrganizationDto | UpdateOrganizationDto): { name: string; nameNormalized: string; city: string | null; cityNormalized: string | null; website: string | null; websiteHost: string | null; instagram: string | null } {
    const name = this.requireText(input.name!, "Organization name");
    const city = this.optionalText(input.city);
    const website = this.normalizeWebsite(input.website);
    return {
      name,
      nameNormalized: normalizeCrmComparable(name),
      city,
      cityNormalized: city ? normalizeCrmComparable(city) : null,
      website: website.website,
      websiteHost: website.host,
      instagram: this.normalizeInstagram(input.instagram),
    };
  }

  private normalizeWebsite(value: string | null | undefined) {
    try { return normalizeCrmWebsite(value); } catch { throw new BadRequestException("Website must be a valid HTTP or HTTPS URL"); }
  }

  private normalizeInstagram(value: string | null | undefined) {
    try { return normalizeInstagramHandle(value); } catch { throw new BadRequestException("Enter an Instagram handle or profile URL"); }
  }

  private normalizePhone(value: string | null | undefined) {
    try { return normalizeContactPhone(value); } catch { throw new BadRequestException("Contact phone must be a valid Iranian mobile number"); }
  }

  private normalizeEmail(value: string | null | undefined) {
    const email = normalizeContactEmail(value);
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new BadRequestException("Contact email is invalid");
    return email;
  }

  private requireText(value: string, label: string) {
    const normalized = normalizeCrmName(value ?? "");
    if (!normalized) throw new BadRequestException(`${label} is required`);
    return normalized;
  }

  private optionalText(value: string | null | undefined) {
    if (value === null || value === undefined || !value.trim()) return null;
    return normalizeCrmName(value);
  }

  private addArchiveFilter(where: string[], values: unknown[], alias: string, status: ArchiveStatus) {
    if (status === "ACTIVE") where.push(`${alias}.archived_at IS NULL`);
    else if (status === "ARCHIVED") where.push(`${alias}.archived_at IS NOT NULL`);
  }

  private addValue(values: unknown[], value: unknown) { values.push(value); return values.length; }

  private async audit(manager: EntityManager, actorId: string, action: string, targetType: string, targetId: string) {
    await manager.query(`INSERT INTO platform_audit_events (actor_user_id, action, target_type, target_id, summary) VALUES ($1, $2, $3, $4, '{}'::jsonb)`, [actorId, action, targetType, targetId]);
  }

  private async auditWithSummary(manager: EntityManager, actorId: string, action: string, targetId: string, summary: Record<string, string>) {
    await manager.query(`INSERT INTO platform_audit_events (actor_user_id, action, target_type, target_id, summary) VALUES ($1, $2, 'crm_organization', $3, $4::jsonb)`, [actorId, action, targetId, JSON.stringify(summary)]);
  }

  private rethrowDatabaseConflict(error: unknown): never {
    const code = (error as { code?: string; constraint?: string })?.code;
    if (code === "23505") throw new ConflictException("This Tenant is already linked to a CRM organization");
    if (code === "23503") throw new NotFoundException("The referenced record was not found");
    throw error;
  }
}
