import { SupportTicketDetail } from "../support-client";

export default async function TenantSupportTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  return <SupportTicketDetail ticketId={ticketId} />;
}
