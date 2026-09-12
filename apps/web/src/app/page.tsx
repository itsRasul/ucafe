import { TenantStorefront } from "./tenant-storefront";
import { loadPlatformOffering, loadPublicPageData } from "./tenant-public-data";
import { SuspendedSite } from "./tenant-public";
import { notFound } from "next/navigation";
import { PlatformLanding } from "./platform-landing";

export default async function HomePage() {
  const data = await loadPublicPageData();
  if (!data.isTenant) return <PlatformLanding offering={await loadPlatformOffering()} />;
  if (!data.context) notFound();
  if (!data.context.available || !data.site || !data.menu) return <SuspendedSite context={data.context} />;
  return <TenantStorefront context={data.context} site={data.site} menu={data.menu} ordering={data.ordering} />;
}
