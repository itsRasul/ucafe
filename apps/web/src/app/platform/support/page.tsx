import { QueueFilters, ticketDepartments, ticketStatuses } from "./support-model";
import { PlatformSupportQueue } from "./support-client";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isOneOf<T extends string>(value: string | undefined, items: readonly { value: T }[]): value is T {
  return items.some((item) => item.value === value);
}

export default async function PlatformSupportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const status = first(params.status);
  const department = first(params.department);
  const requestedPage = Number(first(params.page) ?? "1");
  const filters: QueueFilters = {
    status: status === undefined ? "WAITING_FOR_PLATFORM" : isOneOf(status, ticketStatuses) ? status : "",
    department: isOneOf(department, ticketDepartments) ? department : "",
    search: (first(params.search) ?? "").slice(0, 120),
    tenantSearch: (first(params.tenantSearch) ?? "").slice(0, 120),
    page: Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1000000) : 1,
  };
  return <PlatformSupportQueue filters={filters} />;
}
