import { CrmWorkspace } from "../../workspace";

export default async function CrmOrganizationPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  return <CrmWorkspace mode="detail" organizationId={organizationId} />;
}
