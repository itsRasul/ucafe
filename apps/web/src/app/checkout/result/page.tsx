import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicPageData } from "../../tenant-public-data";
import { SuspendedSite, TenantFooter, TenantHeader, tenantThemeStyle } from "../../tenant-public";
import { CheckoutResultClient } from "./result-client";

export const metadata: Metadata = { title: "نتیجه سفارش | یو کافه" };

export default async function CheckoutResultPage() {
  const data = await loadPublicPageData();
  if (!data.isTenant || !data.context) notFound();
  if (!data.context.available || !data.site || !data.menu) return <SuspendedSite context={data.context} />;
  return <main className={`tenant-home tenant-checkout-page tenant-checkout-result-page radius-${data.site.theme.radiusPreset.toLowerCase()}`} style={tenantThemeStyle(data.site)} id="top">
    <a className="tenant-skip-link" href="#main-content">رفتن به محتوای اصلی</a>
    <TenantHeader site={data.site} />
    <div id="main-content" className="tenant-utility-page"><CheckoutResultClient /></div>
    <TenantFooter site={data.site} />
  </main>;
}
