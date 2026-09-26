import { CrmDealsWorkspace } from "../workspace";

export default async function PlatformCrmNewDealPage({ searchParams }: { searchParams: Promise<{ leadId?: string }> }) {
  const { leadId } = await searchParams;
  return <CrmDealsWorkspace mode="create" leadId={leadId} />;
}
