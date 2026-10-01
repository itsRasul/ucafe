import { PlatformSupportTicket } from "../support-client";

type PageParams = { ticketId: string };
type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PlatformSupportTicketPage({
  params, searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ ticketId }, query] = await Promise.all([params, searchParams]);
  const candidate = first(query.returnTo) ?? "";
  const returnTo = /^\/platform\/support(?:\?|$)/.test(candidate) ? candidate : "/platform/support";
  return <PlatformSupportTicket ticketId={ticketId} returnTo={returnTo} />;
}
