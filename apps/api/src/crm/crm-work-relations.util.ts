import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { EntityManager } from "typeorm";

export type CrmWorkLinks = {
  organizationId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  dealId?: string | null;
};

type Row = { organization_id: string | null; archived_at: Date | null; lead_id?: string | null };

export async function resolveCrmWorkLinks(manager: EntityManager, links: CrmWorkLinks): Promise<Required<Pick<CrmWorkLinks, "organizationId" | "contactId" | "leadId" | "dealId">>> {
  const directIds = [links.organizationId, links.contactId, links.leadId, links.dealId].filter(Boolean);
  if (!directIds.length) throw new BadRequestException("Link this CRM work to at least one CRM record");

  const contexts: string[] = [];
  const organizationId = links.organizationId ?? null;
  if (organizationId) {
    const rows = await manager.query<Row[]>("SELECT id AS organization_id,archived_at FROM crm_organizations WHERE id=$1 FOR SHARE", [organizationId]);
    if (!rows[0]) throw new NotFoundException("CRM Organization not found");
    if (rows[0].archived_at) throw new ConflictException("Restore the Organization before linking CRM work");
    contexts.push(organizationId);
  }

  if (links.contactId) {
    const rows = await manager.query<Row[]>("SELECT organization_id,archived_at FROM crm_contacts WHERE id=$1 FOR SHARE", [links.contactId]);
    if (!rows[0]) throw new NotFoundException("CRM Contact not found");
    if (rows[0].archived_at) throw new ConflictException("Restore the Contact before linking CRM work");
    if (!rows[0].organization_id) throw new BadRequestException("The Contact has no Organization");
    contexts.push(rows[0].organization_id);
  }

  let leadOrganizationId: string | null = null;
  if (links.leadId) {
    const rows = await manager.query<Row[]>("SELECT organization_id,archived_at FROM crm_leads WHERE id=$1 FOR SHARE", [links.leadId]);
    if (!rows[0]) throw new NotFoundException("CRM Lead not found");
    if (rows[0].archived_at) throw new ConflictException("Restore the Lead before linking CRM work");
    leadOrganizationId = rows[0].organization_id;
    if (leadOrganizationId) contexts.push(leadOrganizationId);
  }

  if (links.dealId) {
    const rows = await manager.query<Row[]>("SELECT organization_id,archived_at FROM crm_deals WHERE id=$1 FOR SHARE", [links.dealId]);
    if (!rows[0]) throw new NotFoundException("CRM Deal not found");
    if (rows[0].archived_at) throw new ConflictException("Restore the Deal before linking CRM work");
    if (!rows[0].organization_id) throw new BadRequestException("The Deal has no Organization");
    contexts.push(rows[0].organization_id);
  }

  const uniqueContexts = [...new Set(contexts)];
  if (uniqueContexts.length > 1) throw new BadRequestException("Linked CRM records must belong to the same Organization");
  const resolvedOrganizationId = uniqueContexts[0] ?? null;
  if (links.leadId && !leadOrganizationId && resolvedOrganizationId) {
    throw new BadRequestException("Link the Lead to this Organization before combining it with other CRM records");
  }
  if (resolvedOrganizationId && !organizationId) {
    const rows = await manager.query<Row[]>("SELECT id AS organization_id,archived_at FROM crm_organizations WHERE id=$1 FOR SHARE", [resolvedOrganizationId]);
    if (!rows[0]) throw new NotFoundException("CRM Organization not found");
    if (rows[0].archived_at) throw new ConflictException("Restore the Organization before linking CRM work");
  }

  return {
    organizationId: resolvedOrganizationId,
    contactId: links.contactId ?? null,
    leadId: links.leadId ?? null,
    dealId: links.dealId ?? null,
  };
}
