import { CrmDealsWorkspace } from "../workspace";

export default async function PlatformCrmDealPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  return <CrmDealsWorkspace mode="detail" dealId={dealId} />;
}
