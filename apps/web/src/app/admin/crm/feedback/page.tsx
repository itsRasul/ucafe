import { FeedbackWorkspace } from "./feedback-workspace";

export default async function TenantCrmFeedbackPage({ searchParams }: { searchParams: Promise<{ clientId?: string | string[] }> }) {
  const clientId = (await searchParams).clientId;
  return <FeedbackWorkspace initialClientId={Array.isArray(clientId) ? clientId[0] : clientId} />;
}
