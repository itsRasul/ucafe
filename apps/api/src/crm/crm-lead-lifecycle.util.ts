import { CrmLeadStatus } from "./entities/crm-lead.entity";

const transitions: Record<CrmLeadStatus, readonly CrmLeadStatus[]> = {
  [CrmLeadStatus.New]: [CrmLeadStatus.AttemptingContact, CrmLeadStatus.Contacted, CrmLeadStatus.Unqualified],
  [CrmLeadStatus.AttemptingContact]: [CrmLeadStatus.Contacted, CrmLeadStatus.Nurturing, CrmLeadStatus.Unqualified],
  [CrmLeadStatus.Contacted]: [CrmLeadStatus.AttemptingContact, CrmLeadStatus.Nurturing, CrmLeadStatus.Unqualified],
  [CrmLeadStatus.Qualified]: [CrmLeadStatus.Nurturing, CrmLeadStatus.Unqualified],
  [CrmLeadStatus.Nurturing]: [CrmLeadStatus.AttemptingContact, CrmLeadStatus.Contacted, CrmLeadStatus.Unqualified],
  [CrmLeadStatus.Unqualified]: [],
  [CrmLeadStatus.Converted]: [],
};

export function canTransitionLead(from: CrmLeadStatus, to: CrmLeadStatus): boolean {
  return transitions[from].includes(to);
}

export function canQualifyLead(status: CrmLeadStatus): boolean {
  return status === CrmLeadStatus.Contacted || status === CrmLeadStatus.Nurturing;
}

export function canUnqualifyLead(status: CrmLeadStatus): boolean {
  return transitions[status].includes(CrmLeadStatus.Unqualified);
}
