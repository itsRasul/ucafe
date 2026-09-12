import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CartPageClient } from "./cart-page-client";
import { loadPublicPageData } from "../tenant-public-data";
import { SuspendedSite, TenantFooter, TenantHeader, tenantThemeStyle } from "../tenant-public";

export const metadata: Metadata = { title: "سبد خرید | یو کافه" };

export default async function CartPage() {
  const data = await loadPublicPageData();
  if (!data.isTenant || !data.context) notFound();
  if (!data.context.available || !data.site || !data.menu) return <SuspendedSite context={data.context} />;
  const logo = data.site.media.find((asset) => asset.kind === "LOGO");
  return <main className={`tenant-home tenant-cart-page radius-${data.site.theme.radiusPreset.toLowerCase()}`} style={tenantThemeStyle(data.site)} id="top">
    <a className="tenant-skip-link" href="#main-content">رفتن به محتوای اصلی</a>
    <TenantHeader site={data.site} />
    <div id="main-content" className="tenant-utility-page"><CartPageClient menu={data.menu} ordering={data.ordering} cafeName={data.site.name} logoUrl={logo?.sources.smallWebp} /></div>
    <TenantFooter site={data.site} />
  </main>;
}
