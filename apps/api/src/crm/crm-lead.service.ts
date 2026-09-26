import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import {
  ChangeCrmLeadStatusDto,
  ConvertCrmLeadDto,
  CreateCrmLeadDto,
  CrmLeadListQueryDto,
  QualifyCrmLeadDto,
  UnqualifyCrmLeadDto,
  UpdateCrmLeadDto,
} from "./dto/crm-lead.dto";
import { canQualifyLead, canTransitionLead, canUnqualifyLead } from "./crm-lead-lifecycle.util";
import { escapeLike, normalizeContactEmail, normalizeContactPhone, normalizeCrmComparable, normalizeCrmName, normalizeInstagramHandle, normalizeCrmWebsite } from "./crm-normalization.util";
import { CrmLeadPriority, CrmLeadSource, CrmLeadStatus, CrmLeadUnqualifiedReason } from "./entities/crm-lead.entity";

type DbRow = Record<string, any>;
type LeadInput = Pick<CreateCrmLeadDto, "businessName" | "contactName" | "phone" | "email" | "city" | "website" | "instagram" | "description">;
type LeadValues = {
  businessName: string; businessNameNormalized: string; contactName: string | null;
  phone: string | null; email: string | null; city: string | null; cityNormalized: string | null;
  website: string | null; websiteHost: string | null; instagram: string | null; description: string | null;
};

@Injectable()
export class CrmLeadService {
  constructor(private readonly dataSource: DataSource, private readonly crypto: AuthCryptoService) {}

  async list(query: CrmLeadListQueryDto) {
    const where: string[] = [];
    const values: unknown[] = [];
    if (query.archiveStatus === "ACTIVE") where.push("l.archived_at IS NULL");
    else if (query.archiveStatus === "ARCHIVED") where.push("l.archived_at IS NOT NULL");
    if (query.status) { values.push(query.status); where.push(`l.status=$${values.length}`); }
    if (query.source) { values.push(query.source); where.push(`l.source=$${values.length}`); }
    if (query.priority) { values.push(query.priority); where.push(`l.priority=$${values.length}`); }
    if (query.ownerId === "UNASSIGNED") where.push("l.owner_id IS NULL");
    else if (query.ownerId) { values.push(query.ownerId); where.push(`l.owner_id=$${values.length}`); }
    if (query.organizationId) { values.push(query.organizationId); where.push(`l.organization_id=$${values.length}`); }
    if (query.city) { values.push(normalizeCrmComparable(query.city)); where.push(`l.city_normalized=$${values.length}`); }
    if (query.q) {
      const q = query.q.trim();
      const search = `%${escapeLike(q)}%`;
      values.push(search);
      const textIndex = values.length;
      const matches = [`l.business_name ILIKE $${textIndex} ESCAPE '!'`, `COALESCE(l.contact_name,'') ILIKE $${textIndex} ESCAPE '!'`, `COALESCE(l.city,'') ILIKE $${textIndex} ESCAPE '!'`, `COALESCE(o.name,'') ILIKE $${textIndex} ESCAPE '!'`];
      if (q.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) matches.push(`l.email_hash=$${this.addValue(values, this.crypto.hashEmail(normalizeContactEmail(q)!))}`);
      if (/^[+۰-۹٠-٩0-9\s()-]+$/.test(q) && (q.match(/[0-9۰-۹٠-٩]/g)?.length ?? 0) >= 7) {
        try { matches.push(`l.phone_hash=$${this.addValue(values, this.crypto.hashPhone(normalizeContactPhone(q)!))}`); } catch { /* Keep a partial number as a name search. */ }
      }
      where.push(`(${matches.join(" OR ")})`);
    }
    const predicate = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const counts = await this.dataSource.query<Array<{ total: string }>>(`SELECT count(*)::text AS total FROM crm_leads l LEFT JOIN crm_organizations o ON o.id=l.organization_id ${predicate}`, values);
    const sort = {
      createdAt: "l.created_at",
      updatedAt: "l.updated_at",
      priority: "CASE l.priority WHEN 'HIGH' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END",
      status: "l.status",
    }[query.sort];
    const pageValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
    const items = await this.dataSource.query<DbRow[]>(`
      SELECT l.id, l.business_name AS "businessName", l.contact_name AS "contactName", l.city,
        l.source, l.status, l.priority, l.owner_id AS "ownerId", ${this.ownerLabelSql("u")} AS "ownerLabel",
        l.organization_id AS "organizationId", o.name AS "organizationName",
        l.primary_contact_id AS "primaryContactId", c.name AS "primaryContactName",
        l.source_request_id AS "sourceRequestId", l.qualified_at AS "qualifiedAt", l.converted_at AS "convertedAt",
        l.archived_at AS "archivedAt", l.created_at AS "createdAt", l.updated_at AS "updatedAt"
      FROM crm_leads l
      LEFT JOIN users u ON u.id=l.owner_id
      LEFT JOIN crm_organizations o ON o.id=l.organization_id
      LEFT JOIN crm_contacts c ON c.id=l.primary_contact_id
      ${predicate}
      ORDER BY ${sort} ${query.direction}, l.id ASC
      LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}
    `, pageValues);
    return { items, total: Number(counts[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async listAssignees() {
    return this.dataSource.query<Array<{ id: string; label: string }>>(`
      SELECT DISTINCT u.id,
        CASE WHEN u.phone IS NOT NULL THEN 'اپراتور ·•••' || right(u.phone,4)
             WHEN u.email IS NOT NULL THEN 'اپراتور ' || left(u.email,1) || '…'
             ELSE 'اپراتور ' || left(u.id::text,8) END AS label
      FROM users u
      JOIN user_platform_roles upr ON upr.user_id=u.id
      JOIN roles r ON r.id=upr.role_id AND r.scope='PLATFORM'
      JOIN role_permissions rp ON rp.role_id=r.id
      JOIN permissions p ON p.id=rp.permission_id AND p.scope='PLATFORM' AND p.key IN ('crm.read','crm.manage')
      WHERE u.status='ACTIVE' AND u.deleted_at IS NULL
      ORDER BY label, u.id
    `);
  }

  async duplicateCandidates(input: LeadInput, excludeId?: string) {
    const values = this.leadValues(input);
    return this.findPotentialDuplicates(this.dataSource, values, excludeId);
  }

  async get(id: string) {
    const row = await this.findLead(this.dataSource, id, true);
    if (!row) throw new NotFoundException("CRM lead not found");
    const history = await this.dataSource.query<DbRow[]>(`
      SELECT h.id, h.previous_status AS "previousStatus", h.next_status AS "nextStatus", h.reason,
        h.created_at AS "createdAt", ${this.ownerLabelSql("u")} AS "actorLabel"
      FROM crm_lead_status_history h LEFT JOIN users u ON u.id=h.changed_by_user_id
      WHERE h.lead_id=$1 ORDER BY h.created_at, h.id
    `, [id]);
    return { ...this.projection(row, true), statusHistory: history };
  }

  async create(input: CreateCrmLeadDto, actorId: string) {
    const values = this.leadValues(input);
    return this.dataSource.transaction(async (manager) => {
      await this.assertCrmAssignee(manager, input.ownerId ?? null);
      const links = await this.resolveLinks(manager, input.organizationId ?? null, input.primaryContactId ?? null);
      const duplicates = await this.findPotentialDuplicates(manager, values);
      const remaining = this.withoutSelected(duplicates, links.organizationId, links.contactId);
      if (remaining.length && !input.allowPotentialDuplicates) this.throwDuplicates(remaining);
      const id = await this.insertLead(manager, values, {
        source: input.source, priority: input.priority ?? CrmLeadPriority.Normal, ownerId: input.ownerId ?? null,
        organizationId: links.organizationId, contactId: links.contactId, sourceRequestId: null,
        actorId, status: CrmLeadStatus.New,
      });
      await this.audit(manager, actorId, "crm.lead.created", id, { source: input.source });
      return this.projection((await this.findLead(manager, id, true))!, true);
    });
  }

  async update(id: string, input: UpdateCrmLeadDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.findLead(manager, id, true, true);
      if (!current) throw new NotFoundException("CRM lead not found");
      this.assertEditable(current);
      if (current.status === CrmLeadStatus.Converted) throw new ConflictException("Converted lead details and links are preserved as history");
      const values = this.leadValues({
        businessName: input.businessName ?? current.business_name,
        contactName: input.contactName === undefined ? current.contact_name : input.contactName,
        phone: input.phone === undefined ? (current.phone_encrypted ? this.crypto.decryptPii(current.phone_encrypted) : null) : input.phone,
        email: input.email === undefined ? (current.email_encrypted ? this.crypto.decryptPii(current.email_encrypted) : null) : input.email,
        city: input.city === undefined ? current.city : input.city,
        website: input.website === undefined ? current.website : input.website,
        instagram: input.instagram === undefined ? current.instagram_handle : input.instagram,
        description: input.description === undefined ? current.description : input.description,
      });
      const ownerId = input.ownerId === undefined ? current.owner_id : input.ownerId;
      if (input.ownerId !== undefined) await this.assertCrmAssignee(manager, ownerId);
      const organizationId = input.organizationId === undefined ? current.organization_id : input.organizationId;
      const contactId = input.primaryContactId === undefined ? current.primary_contact_id : input.primaryContactId;
      const organizationChanged = organizationId !== current.organization_id;
      const contactChanged = contactId !== current.primary_contact_id;
      let links = { organizationId, contactId };
      if (organizationChanged || contactChanged) {
        links = !organizationChanged && !contactId
          ? { organizationId, contactId: null }
          : await this.resolveLinks(manager, organizationId, contactId);
      }
      const identityChanged = values.businessNameNormalized !== current.business_name_normalized
        || (values.phone ? this.crypto.hashPhone(values.phone) : null) !== current.phone_hash
        || (values.email ? this.crypto.hashEmail(values.email) : null) !== current.email_hash
        || values.cityNormalized !== current.city_normalized
        || values.websiteHost !== current.website_host
        || values.instagram !== current.instagram_handle;
      if (identityChanged) {
        const duplicates = await this.findPotentialDuplicates(manager, values, id);
        const remaining = this.withoutSelected(duplicates, links.organizationId, links.contactId);
        if (remaining.length && !input.allowPotentialDuplicates) this.throwDuplicates(remaining);
      }
      await manager.query(`
        UPDATE crm_leads SET business_name=$2, business_name_normalized=$3, contact_name=$4,
          phone_encrypted=$5, phone_hash=$6, email_encrypted=$7, email_hash=$8,
          city=$9, city_normalized=$10, website=$11, website_host=$12, instagram_handle=$13,
          description=$14, priority=$15, owner_id=$16, organization_id=$17, primary_contact_id=$18,
          updated_by_user_id=$19, updated_at=now() WHERE id=$1
      `, [id, values.businessName, values.businessNameNormalized, values.contactName,
        values.phone ? this.crypto.encryptPii(values.phone) : null, values.phone ? this.crypto.hashPhone(values.phone) : null,
        values.email ? this.crypto.encryptPii(values.email) : null, values.email ? this.crypto.hashEmail(values.email) : null,
        values.city, values.cityNormalized, values.website, values.websiteHost, values.instagram, values.description,
        input.priority ?? current.priority, ownerId, links.organizationId, links.contactId, actorId]);
      await this.audit(manager, actorId, "crm.lead.updated", id, { assigned: ownerId !== current.owner_id });
      return this.projection((await this.findLead(manager, id, true))!, true);
    });
  }

  async changeStatus(id: string, input: ChangeCrmLeadStatusDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const lead = await this.requireLockedLead(manager, id);
      this.assertEditable(lead);
      const current = lead.status as CrmLeadStatus;
      if (!canTransitionLead(current, input.status)) throw new ConflictException(`Lead cannot move from ${current} to ${input.status}`);
      await this.changeStatusIn(manager, lead, input.status, actorId, input.reason?.trim() || null);
      await this.audit(manager, actorId, "crm.lead.status_changed", id, { from: current, to: input.status });
      return this.projection((await this.findLead(manager, id, true))!, true);
    });
  }

  async qualify(id: string, input: QualifyCrmLeadDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const lead = await this.requireLockedLead(manager, id);
      this.assertEditable(lead);
      const current = lead.status as CrmLeadStatus;
      if (!canQualifyLead(current)) throw new ConflictException(`Lead cannot be qualified from ${current}`);
      const notes = input.qualificationNotes === undefined ? lead.qualification_notes : this.optionalText(input.qualificationNotes);
      await manager.query(`UPDATE crm_leads SET status=$2, qualification_notes=$3, qualified_at=COALESCE(qualified_at,now()), updated_by_user_id=$4, updated_at=now() WHERE id=$1`, [id, CrmLeadStatus.Qualified, notes, actorId]);
      await this.appendHistory(manager, id, current, CrmLeadStatus.Qualified, null, actorId);
      await this.audit(manager, actorId, "crm.lead.qualified", id);
      return this.projection((await this.findLead(manager, id, true))!, true);
    });
  }

  async unqualify(id: string, input: UnqualifyCrmLeadDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const lead = await this.requireLockedLead(manager, id);
      this.assertEditable(lead);
      const current = lead.status as CrmLeadStatus;
      if (!canUnqualifyLead(current)) throw new ConflictException(`Lead cannot be unqualified from ${current}`);
      const detail = input.reason === CrmLeadUnqualifiedReason.Other ? this.optionalText(input.detail) : null;
      await manager.query(`UPDATE crm_leads SET status=$2, unqualified_reason=$3, unqualified_reason_detail=$4, updated_by_user_id=$5, updated_at=now() WHERE id=$1`, [id, CrmLeadStatus.Unqualified, input.reason, detail, actorId]);
      await this.appendHistory(manager, id, current, CrmLeadStatus.Unqualified, detail, actorId);
      await this.audit(manager, actorId, "crm.lead.unqualified", id, { reason: input.reason });
      return this.projection((await this.findLead(manager, id, true))!, true);
    });
  }

  async convert(id: string, input: ConvertCrmLeadDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const lead = await this.requireLockedLead(manager, id);
      if (lead.status === CrmLeadStatus.Converted) return this.projection(lead, true);
      this.assertEditable(lead);
      if (lead.status !== CrmLeadStatus.Qualified) throw new ConflictException("Only qualified leads can be converted");
      if (input.organizationMode === "LINK" && !input.organizationId) throw new BadRequestException("Choose an organization to link");
      if (input.organizationMode === "CREATE" && input.organizationId) throw new BadRequestException("Do not send an organization ID when creating one");
      if (input.contactMode !== "CREATE" && input.contactMode !== "LINK") throw new BadRequestException("Choose or create a contact to complete conversion");
      if (input.contactMode === "LINK" && !input.contactId) throw new BadRequestException("Choose a contact to link");
      if (input.contactMode !== "LINK" && input.contactId) throw new BadRequestException("Contact ID is only valid when linking a contact");
      if (input.organizationMode === "CREATE" && input.contactMode === "LINK") throw new BadRequestException("A contact can only be linked to an existing organization");

      let organizationId: string;
      if (input.organizationMode === "LINK") {
        organizationId = await this.requireActiveOrganization(manager, input.organizationId!);
      } else {
        const candidates = await this.findOrganizationDuplicates(manager, lead.business_name_normalized, lead.city_normalized, lead.website_host, lead.instagram_handle);
        if (candidates.length && !input.confirmPotentialDuplicates) this.throwDuplicates(candidates);
        organizationId = await this.insertOrganizationFromLead(manager, lead, actorId);
      }

      let contactId: string | null = null;
      if (input.contactMode === "LINK") {
        contactId = await this.requireContactInOrganization(manager, input.contactId!, organizationId);
      } else if (input.contactMode === "CREATE") {
        const name = this.requireText(lead.contact_name ?? "", "Contact name");
        const phone = lead.phone_encrypted ? this.crypto.decryptPii(lead.phone_encrypted) : null;
        const email = lead.email_encrypted ? this.crypto.decryptPii(lead.email_encrypted) : null;
        const candidates = await this.findContactDuplicates(manager, organizationId, phone, email);
        if (candidates.length && !input.confirmPotentialDuplicates) this.throwDuplicates(candidates);
        contactId = await this.insertContactFromLead(manager, organizationId, name, phone, email, actorId);
      }
      const now = new Date();
      await manager.query(`UPDATE crm_leads SET status=$2, organization_id=$3, primary_contact_id=$4, converted_at=$5, updated_by_user_id=$6, updated_at=$5 WHERE id=$1`, [id, CrmLeadStatus.Converted, organizationId, contactId, now, actorId]);
      await this.appendHistory(manager, id, CrmLeadStatus.Qualified, CrmLeadStatus.Converted, null, actorId);
      await this.audit(manager, actorId, "crm.lead.converted", id, { organizationId, contactId });
      return this.projection((await this.findLead(manager, id, true))!, true);
    });
  }

  async archive(id: string, actorId: string) { return this.setArchived(id, actorId, true); }
  async restore(id: string, actorId: string) { return this.setArchived(id, actorId, false); }

  private async setArchived(id: string, actorId: string, archive: boolean) {
    return this.dataSource.transaction(async (manager) => {
      const lead = await this.requireLockedLead(manager, id);
      if (Boolean(lead.archived_at) === archive) return this.projection(lead, true);
      await manager.query(`UPDATE crm_leads SET archived_at=$2, updated_by_user_id=$3, updated_at=now() WHERE id=$1`, [id, archive ? new Date() : null, actorId]);
      await this.audit(manager, actorId, archive ? "crm.lead.archived" : "crm.lead.restored", id);
      return this.projection((await this.findLead(manager, id, true))!, true);
    });
  }

  async createFromRequest(manager: EntityManager, input: { id: string; businessName: string; contactName: string; phone: string; city: string; description: string | null }) {
    const existing = await manager.query<DbRow[]>("SELECT id FROM crm_leads WHERE source_request_id=$1", [input.id]);
    if (existing[0]) return existing[0].id as string;
    const values = this.leadValues({ ...input, email: null, website: null, instagram: null });
    const id = randomUUID();
    const rows = await manager.query<DbRow[]>(`
      INSERT INTO crm_leads (id, business_name, business_name_normalized, contact_name, phone_encrypted, phone_hash,
        city, city_normalized, description, source, status, priority, source_request_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (source_request_id) WHERE source_request_id IS NOT NULL DO NOTHING
      RETURNING id
    `, [id, values.businessName, values.businessNameNormalized, values.contactName,
      values.phone ? this.crypto.encryptPii(values.phone) : null, values.phone ? this.crypto.hashPhone(values.phone) : null,
      values.city, values.cityNormalized, values.description, CrmLeadSource.LandingForm, CrmLeadStatus.New, CrmLeadPriority.Normal, input.id]);
    const leadId = rows[0]?.id as string | undefined;
    if (leadId) await this.appendHistory(manager, leadId, null, CrmLeadStatus.New, "Created from public consultation request", null);
    if (leadId) return leadId;
    const retry = await manager.query<DbRow[]>("SELECT id FROM crm_leads WHERE source_request_id=$1", [input.id]);
    if (!retry[0]) throw new ConflictException("Lead could not be linked to the consultation request");
    return retry[0].id as string;
  }

  private async insertLead(manager: EntityManager, values: LeadValues, extras: { source: CrmLeadSource; priority: CrmLeadPriority; ownerId: string | null; organizationId: string | null; contactId: string | null; sourceRequestId: string | null; actorId: string | null; status: CrmLeadStatus }) {
    const rows = await manager.query<DbRow[]>(`
      INSERT INTO crm_leads (business_name,business_name_normalized,contact_name,phone_encrypted,phone_hash,email_encrypted,email_hash,city,city_normalized,website,website_host,instagram_handle,description,source,status,priority,owner_id,organization_id,primary_contact_id,source_request_id,created_by_user_id,updated_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21) RETURNING id
    `, [values.businessName, values.businessNameNormalized, values.contactName,
      values.phone ? this.crypto.encryptPii(values.phone) : null, values.phone ? this.crypto.hashPhone(values.phone) : null,
      values.email ? this.crypto.encryptPii(values.email) : null, values.email ? this.crypto.hashEmail(values.email) : null,
      values.city, values.cityNormalized, values.website, values.websiteHost, values.instagram, values.description,
      extras.source, extras.status, extras.priority, extras.ownerId, extras.organizationId, extras.contactId, extras.sourceRequestId, extras.actorId]);
    const id = rows[0]!.id as string;
    await this.appendHistory(manager, id, null, extras.status, null, extras.actorId);
    return id;
  }

  private async findLead(manager: DataSource | EntityManager, id: string, includePii = false, lock = false): Promise<DbRow | null> {
    const pii = includePii ? ", l.phone_encrypted, l.email_encrypted" : "";
    const rows = await manager.query<DbRow[]>(`
      SELECT l.*, ${this.ownerLabelSql("u")} AS owner_label, o.name AS organization_name,
        c.name AS primary_contact_name, c.role AS primary_contact_role,
        r.business_stage AS source_request_business_stage, r.requested_services AS source_request_services,
        r.created_at AS source_request_created_at${pii}
      FROM crm_leads l LEFT JOIN users u ON u.id=l.owner_id
      LEFT JOIN crm_organizations o ON o.id=l.organization_id
      LEFT JOIN crm_contacts c ON c.id=l.primary_contact_id
      LEFT JOIN platform_order_requests r ON r.id=l.source_request_id
      WHERE l.id=$1 ${lock ? "FOR UPDATE OF l" : ""}
    `, [id]);
    return rows[0] ?? null;
  }

  private async requireLockedLead(manager: EntityManager, id: string) {
    const lead = await this.findLead(manager, id, true, true);
    if (!lead) throw new NotFoundException("CRM lead not found");
    return lead;
  }

  private projection(row: DbRow, includePii = false) {
    const result: DbRow = {
      id: row.id, businessName: row.business_name, contactName: row.contact_name,
      city: row.city, website: row.website, instagram: row.instagram_handle, description: row.description,
      source: row.source, status: row.status, priority: row.priority,
      ownerId: row.owner_id, ownerLabel: row.owner_label,
      organizationId: row.organization_id, organizationName: row.organization_name,
      primaryContactId: row.primary_contact_id,
      primaryContact: row.primary_contact_id ? { id: row.primary_contact_id, name: row.primary_contact_name, role: row.primary_contact_role } : null,
      sourceRequestId: row.source_request_id, qualificationNotes: row.qualification_notes,
      sourceRequest: row.source_request_id ? { id: row.source_request_id, businessStage: row.source_request_business_stage, requestedServices: row.source_request_services, createdAt: row.source_request_created_at } : null,
      unqualifiedReason: row.unqualified_reason, unqualifiedReasonDetail: row.unqualified_reason_detail,
      qualifiedAt: row.qualified_at, convertedAt: row.converted_at, archivedAt: row.archived_at,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
    if (includePii) {
      result.phone = row.phone_encrypted ? this.crypto.decryptPii(row.phone_encrypted) : null;
      result.email = row.email_encrypted ? this.crypto.decryptPii(row.email_encrypted) : null;
    }
    return result;
  }

  private leadValues(input: LeadInput): LeadValues {
    const businessName = this.requireText(input.businessName ?? "", "Business name");
    const city = this.optionalText(input.city);
    let website: { website: string | null; host: string | null };
    try { website = normalizeCrmWebsite(input.website); } catch { throw new BadRequestException("Website must be a valid HTTP or HTTPS URL"); }
    let instagram: string | null;
    try { instagram = normalizeInstagramHandle(input.instagram); } catch { throw new BadRequestException("Enter an Instagram handle or profile URL"); }
    let phone: string | null;
    try { phone = normalizeContactPhone(input.phone); } catch { throw new BadRequestException("Lead phone must be a valid Iranian mobile number"); }
    const email = normalizeContactEmail(input.email);
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new BadRequestException("Lead email is invalid");
    return {
      businessName, businessNameNormalized: normalizeCrmComparable(businessName),
      contactName: input.contactName?.trim() ? this.requireText(input.contactName, "Contact name") : null,
      phone, email, city, cityNormalized: city ? normalizeCrmComparable(city) : null,
      website: website.website, websiteHost: website.host, instagram,
      description: input.description?.trim() ? input.description.trim() : null,
    };
  }

  private async resolveLinks(manager: EntityManager, organizationId: string | null, contactId: string | null) {
    if (organizationId) await this.requireActiveOrganization(manager, organizationId);
    if (contactId) {
      const rows = await manager.query<DbRow[]>("SELECT organization_id, archived_at FROM crm_contacts WHERE id=$1", [contactId]);
      if (!rows[0]) throw new NotFoundException("CRM contact not found");
      if (rows[0].archived_at) throw new ConflictException("Restore this contact before linking it to a lead");
      if (organizationId && rows[0].organization_id !== organizationId) throw new BadRequestException("The contact belongs to a different organization");
      organizationId ??= rows[0].organization_id as string;
      if (!organizationId) throw new BadRequestException("A contact must belong to an organization");
      await this.requireActiveOrganization(manager, organizationId);
    }
    return { organizationId, contactId };
  }

  async assertCrmAssignee(manager: EntityManager, userId: string | null) {
    if (!userId) return;
    const rows = await manager.query<DbRow[]>(`
      SELECT u.id FROM users u
      WHERE u.id=$1 AND u.status='ACTIVE' AND u.deleted_at IS NULL AND EXISTS (
        SELECT 1 FROM user_platform_roles upr JOIN roles r ON r.id=upr.role_id AND r.scope='PLATFORM'
        JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id
        WHERE upr.user_id=u.id AND p.scope='PLATFORM' AND p.key IN ('crm.read','crm.manage')
      )
    `, [userId]);
    if (!rows[0]) throw new BadRequestException("Choose an active platform user with CRM access");
  }

  private async requireActiveOrganization(manager: EntityManager, id: string) {
    const rows = await manager.query<DbRow[]>("SELECT id, archived_at FROM crm_organizations WHERE id=$1", [id]);
    if (!rows[0]) throw new NotFoundException("CRM organization not found");
    if (rows[0].archived_at) throw new ConflictException("Restore the organization before linking this lead");
    return rows[0].id as string;
  }

  private async requireContactInOrganization(manager: EntityManager, contactId: string, organizationId: string) {
    const rows = await manager.query<DbRow[]>("SELECT id, archived_at FROM crm_contacts WHERE id=$1 AND organization_id=$2", [contactId, organizationId]);
    if (!rows[0]) throw new NotFoundException("The selected contact does not belong to this organization");
    if (rows[0].archived_at) throw new ConflictException("Restore the contact before linking it to a lead");
    return rows[0].id as string;
  }

  private async insertOrganizationFromLead(manager: EntityManager, lead: DbRow, actorId: string) {
    const rows = await manager.query<DbRow[]>(`
      INSERT INTO crm_organizations (name,name_normalized,city,city_normalized,website,website_host,instagram_handle,created_by_user_id,updated_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id
    `, [lead.business_name, lead.business_name_normalized, lead.city, lead.city_normalized, lead.website, lead.website_host, lead.instagram_handle, actorId]);
    return rows[0]!.id as string;
  }

  private async insertContactFromLead(manager: EntityManager, organizationId: string, name: string, phone: string | null, email: string | null, actorId: string) {
    const rows = await manager.query<DbRow[]>(`
      INSERT INTO crm_contacts (organization_id,name,phone_encrypted,phone_hash,email_encrypted,email_hash,created_by_user_id,updated_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id
    `, [organizationId, name,
      phone ? this.crypto.encryptPii(phone) : null, phone ? this.crypto.hashPhone(phone) : null,
      email ? this.crypto.encryptPii(email) : null, email ? this.crypto.hashEmail(email) : null, actorId]);
    return rows[0]!.id as string;
  }

  private async findContactDuplicates(manager: DataSource | EntityManager, organizationId: string, phone: string | null, email: string | null) {
    const phoneHash = phone ? this.crypto.hashPhone(phone) : null;
    const emailHash = email ? this.crypto.hashEmail(email) : null;
    if (!phoneHash && !emailHash) return [];
    const values: unknown[] = [organizationId];
    const terms: string[] = [];
    const fields: string[] = [];
    if (phoneHash) { values.push(phoneHash); terms.push(`c.phone_hash=$${values.length}`); fields.push(`CASE WHEN c.phone_hash=$${values.length} THEN 'phone' END`); }
    if (emailHash) { values.push(emailHash); terms.push(`c.email_hash=$${values.length}`); fields.push(`CASE WHEN c.email_hash=$${values.length} THEN 'email' END`); }
    return manager.query<DbRow[]>(`
      SELECT 'CONTACT' AS type,c.id,c.name AS "contactName",c.organization_id AS "organizationId",o.name AS "organizationName",c.archived_at AS "archivedAt",
        array_remove(ARRAY[${fields.join(",")}],NULL) AS "matchingFields"
      FROM crm_contacts c JOIN crm_organizations o ON o.id=c.organization_id
      WHERE c.organization_id=$1 AND (${terms.join(" OR ")}) ORDER BY (c.archived_at IS NULL) DESC,c.name LIMIT 20
    `, values);
  }

  private async findPotentialDuplicates(manager: DataSource | EntityManager, lead: LeadValues, excludeId?: string) {
    const candidates: DbRow[] = [];
    if (lead.city) {
      const orgs = await manager.query<DbRow[]>(`
        SELECT 'ORGANIZATION' AS type,o.id,o.name AS "businessName",o.city,o.id AS "organizationId",NULL::uuid AS "contactId",o.archived_at AS "archivedAt",ARRAY['business_name_city'] AS "matchingFields"
        FROM crm_organizations o WHERE o.name_normalized=$1 AND o.city_normalized=$2 ORDER BY (o.archived_at IS NULL) DESC,o.name LIMIT 20
      `, [lead.businessNameNormalized, lead.cityNormalized]);
      candidates.push(...orgs);
      const leads = await manager.query<DbRow[]>(`
        SELECT 'LEAD' AS type,l.id,l.business_name AS "businessName",l.city,l.organization_id AS "organizationId",l.primary_contact_id AS "contactId",l.status,l.archived_at AS "archivedAt",ARRAY['business_name_city'] AS "matchingFields"
        FROM crm_leads l WHERE l.business_name_normalized=$1 AND l.city_normalized=$2 AND ($3::uuid IS NULL OR l.id<>$3) ORDER BY (l.archived_at IS NULL) DESC,l.created_at DESC LIMIT 20
      `, [lead.businessNameNormalized, lead.cityNormalized, excludeId ?? null]);
      candidates.push(...leads);
    }
    const phoneHash = lead.phone ? this.crypto.hashPhone(lead.phone) : null;
    const emailHash = lead.email ? this.crypto.hashEmail(lead.email) : null;
    if (phoneHash || emailHash) {
      const contactValues: unknown[] = [];
      const terms: string[] = [];
      const fields: string[] = [];
      if (phoneHash) { contactValues.push(phoneHash); terms.push(`c.phone_hash=$${contactValues.length}`); fields.push(`CASE WHEN c.phone_hash=$${contactValues.length} THEN 'phone' END`); }
      if (emailHash) { contactValues.push(emailHash); terms.push(`c.email_hash=$${contactValues.length}`); fields.push(`CASE WHEN c.email_hash=$${contactValues.length} THEN 'email' END`); }
      const contacts = await manager.query<DbRow[]>(`
        SELECT 'CONTACT' AS type,c.id,c.name AS "contactName",o.name AS "organizationName",c.organization_id AS "organizationId",c.archived_at AS "archivedAt",
          array_remove(ARRAY[${fields.join(",")}],NULL) AS "matchingFields"
        FROM crm_contacts c JOIN crm_organizations o ON o.id=c.organization_id WHERE (${terms.join(" OR ")})
        ORDER BY (c.archived_at IS NULL) DESC,c.name LIMIT 20
      `, contactValues);
      candidates.push(...contacts);
      const leadValues: unknown[] = [];
      const leadTerms: string[] = [];
      const leadFields: string[] = [];
      if (phoneHash) { leadValues.push(phoneHash); leadTerms.push(`l.phone_hash=$${leadValues.length}`); leadFields.push(`CASE WHEN l.phone_hash=$${leadValues.length} THEN 'phone' END`); }
      if (emailHash) { leadValues.push(emailHash); leadTerms.push(`l.email_hash=$${leadValues.length}`); leadFields.push(`CASE WHEN l.email_hash=$${leadValues.length} THEN 'email' END`); }
      leadValues.push(excludeId ?? null);
      const leads = await manager.query<DbRow[]>(`
        SELECT 'LEAD' AS type,l.id,l.business_name AS "businessName",l.city,l.organization_id AS "organizationId",l.primary_contact_id AS "contactId",l.status,l.archived_at AS "archivedAt",
          array_remove(ARRAY[${leadFields.join(",")}],NULL) AS "matchingFields"
        FROM crm_leads l WHERE (${leadTerms.join(" OR ")}) AND ($${leadValues.length}::uuid IS NULL OR l.id<>$${leadValues.length})
        ORDER BY (l.archived_at IS NULL) DESC,l.created_at DESC LIMIT 20
      `, leadValues);
      candidates.push(...leads);
    }
    const selected = new Map<string, DbRow>();
    for (const candidate of candidates) {
      const key = `${candidate.type}:${candidate.id}`;
      const current = selected.get(key);
      if (current) current.matchingFields = [...new Set([...(current.matchingFields as string[]), ...(candidate.matchingFields as string[])])];
      else selected.set(key, candidate);
    }
    return [...selected.values()].slice(0, 20);
  }

  private withoutSelected(candidates: DbRow[], organizationId: string | null, contactId: string | null) {
    return candidates.filter((item) => !(item.type === "ORGANIZATION" && item.id === organizationId) && !(item.type === "CONTACT" && item.id === contactId));
  }

  private throwDuplicates(candidates: DbRow[]): never {
    throw new ConflictException({ message: "Potential duplicate CRM records found", candidates });
  }

  private async changeStatusIn(manager: EntityManager, lead: DbRow, status: CrmLeadStatus, actorId: string, reason: string | null) {
    const current = lead.status as CrmLeadStatus;
    await manager.query(`UPDATE crm_leads SET status=$2, updated_by_user_id=$3, updated_at=now() WHERE id=$1`, [lead.id, status, actorId]);
    await this.appendHistory(manager, lead.id, current, status, reason, actorId);
  }

  private async appendHistory(manager: EntityManager, leadId: string, previous: CrmLeadStatus | null, next: CrmLeadStatus, reason: string | null, actorId: string | null) {
    await manager.query(`INSERT INTO crm_lead_status_history (lead_id,previous_status,next_status,reason,changed_by_user_id) VALUES ($1,$2,$3,$4,$5)`, [leadId, previous, next, reason, actorId]);
  }

  private async audit(manager: EntityManager, actorId: string, action: string, id: string, summary: Record<string, string | boolean | null> = {}) {
    await manager.query(`INSERT INTO platform_audit_events (actor_user_id,action,target_type,target_id,summary) VALUES ($1,$2,'crm_lead',$3,$4::jsonb)`, [actorId, action, id, JSON.stringify(summary)]);
  }

  private assertEditable(lead: DbRow) {
    if (lead.archived_at) throw new ConflictException("Restore this lead before editing it");
  }

  private ownerLabelSql(alias: string) {
    return `CASE WHEN ${alias}.id IS NULL THEN NULL WHEN ${alias}.phone IS NOT NULL THEN 'اپراتور ·•••' || right(${alias}.phone,4) WHEN ${alias}.email IS NOT NULL THEN 'اپراتور ' || left(${alias}.email,1) || '…' ELSE 'اپراتور ' || left(${alias}.id::text,8) END`;
  }

  private async findOrganizationDuplicates(manager: EntityManager, name: string, city: string | null, websiteHost: string | null, instagram: string | null): Promise<DbRow[]> {
    const candidates: DbRow[] = [];
    if (city) candidates.push(...await manager.query<DbRow[]>(`
      SELECT 'ORGANIZATION' AS type,o.id,o.name AS "businessName",o.city,o.id AS "organizationId",NULL::uuid AS "contactId",o.archived_at AS "archivedAt",ARRAY['business_name_city'] AS "matchingFields"
      FROM crm_organizations o WHERE o.name_normalized=$1 AND o.city_normalized=$2 ORDER BY (o.archived_at IS NULL) DESC,o.name LIMIT 20
    `, [name, city]));
    const values: unknown[] = [];
    const checks: string[] = [];
    const fields: string[] = [];
    if (websiteHost) { values.push(websiteHost); checks.push(`o.website_host=$${values.length}`); fields.push(`CASE WHEN o.website_host=$${values.length} THEN 'website' END`); }
    if (instagram) { values.push(instagram); checks.push(`o.instagram_handle=$${values.length}`); fields.push(`CASE WHEN o.instagram_handle=$${values.length} THEN 'instagram' END`); }
    if (checks.length) candidates.push(...await manager.query<DbRow[]>(`
      SELECT 'ORGANIZATION' AS type,o.id,o.name AS "businessName",o.city,o.id AS "organizationId",NULL::uuid AS "contactId",o.archived_at AS "archivedAt",array_remove(ARRAY[${fields.join(",")}],NULL) AS "matchingFields"
      FROM crm_organizations o WHERE ${checks.join(" OR ")} ORDER BY (o.archived_at IS NULL) DESC,o.name LIMIT 20
    `, values));
    const combined = new Map<string, DbRow>();
    for (const candidate of candidates) {
      const previous = combined.get(candidate.id as string);
      if (previous) previous.matchingFields = [...new Set([...(previous.matchingFields as string[]), ...(candidate.matchingFields as string[])])];
      else combined.set(candidate.id as string, candidate);
    }
    return [...combined.values()];
  }

  private requireText(value: string, label: string) {
    const normalized = normalizeCrmName(value ?? "");
    if (!normalized) throw new BadRequestException(`${label} is required`);
    return normalized;
  }

  private optionalText(value: string | null | undefined) {
    return value === null || value === undefined || !value.trim() ? null : normalizeCrmName(value);
  }

  private addValue(values: unknown[], value: unknown) { values.push(value); return values.length; }
}
