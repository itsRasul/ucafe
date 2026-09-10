import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutClient } from "./checkout-client";
import { loadPublicPageData } from "../tenant-public-data";
import { SuspendedSite, TenantFooter, TenantHeader, tenantThemeStyle } from "../tenant-public";

export const metadata: Metadata = { title: "تسویه سفارش | یو کافه" };

export default async function CheckoutPage() {
  const data = await loadPublicPageData();
  if (!data.isTenant || !data.context) notFound();
  if (!data.context.available || !data.site || !data.menu) return <SuspendedSite context={data.context} />;
  return <main className={`tenant-home tenant-checkout-page radius-${data.site.theme.radiusPreset.toLowerCase()}`} style={tenantThemeStyle(data.site)} id="top">
    <a className="tenant-skip-link" href="#main-content">رفتن به محتوای اصلی</a>
    <TenantHeader site={data.site} />
    <div id="main-content" className="tenant-utility-page"><CheckoutClient menu={data.menu} ordering={data.ordering} /></div>
    <TenantFooter site={data.site} />
  </main>;
}
