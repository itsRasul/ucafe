import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MenuExplorer } from "./menu-explorer";
import { loadPublicPageData } from "../tenant-public-data";
import { Picture, SuspendedSite, TenantFooter, TenantHeader, tenantThemeStyle } from "../tenant-public";

export async function generateMetadata(): Promise<Metadata> {
  const data = await loadPublicPageData();
  if (!data.isTenant || !data.context?.available || !data.site) return { title: "منوی کافه | یو کافه" };
  return { title: `منوی ${data.site.name}`, description: `منوی کامل ${data.site.name}، دسته‌بندی‌ها، قیمت‌ها و جزئیات آیتم‌ها` };
}

export default async function MenuPage({ searchParams }: { searchParams: Promise<{ item?: string | string[] }> }) {
  const data = await loadPublicPageData();
  if (!data.isTenant || !data.context) notFound();
  if (!data.context.available || !data.site || !data.menu) return <SuspendedSite context={data.context} />;

  const params = await searchParams;
  const initialItemId = typeof params.item === "string" ? params.item : undefined;
  const hero = data.site.media.find((asset) => asset.kind === "HERO");

  return <main className={`tenant-home tenant-menu-page radius-${data.site.theme.radiusPreset.toLowerCase()}`} style={tenantThemeStyle(data.site)} id="top">
    <a className="tenant-skip-link" href="#main-content">رفتن به محتوای اصلی</a>
    <TenantHeader site={data.site} />
    <section className="menu-page-masthead" id="main-content" aria-labelledby="menu-page-title">
      <Picture asset={hero} fallback="menu" alt={hero ? `منوی ${data.site.name}` : "قهوه و خوراکی‌های کافه"} className="menu-page-masthead-image" eager />
      <div className="menu-page-masthead-shade" aria-hidden="true" />
      <div className="menu-page-masthead-copy">
        <p>منوی کافه</p>
        <h1 id="menu-page-title">منوی {data.site.name}</h1>
        <span>همه انتخاب‌ها، قیمت‌ها و جزئیات در یک نگاه</span>
      </div>
    </section>
    <MenuExplorer menu={data.menu} initialItemId={initialItemId} />
    <TenantFooter site={data.site} />
  </main>;
}
