import { CrmLeadsWorkspace } from "../workspace";

export default async function CrmLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  return <CrmLeadsWorkspace mode="detail" leadId={leadId} />;
}
