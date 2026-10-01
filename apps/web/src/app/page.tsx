import { TenantStorefront } from "./tenant-storefront";
import { loadPlatformCatalog, loadPublicPageData } from "./tenant-public-data";
import { SuspendedSite } from "./tenant-public";
import { notFound } from "next/navigation";
import { PlatformLanding } from "./platform-landing";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const data = await loadPublicPageData();
  if (data.isTenant) return { title: data.context && data.site ? `${data.site.name} | یوکافه` : "کافه | یوکافه" };
  const origin = process.env.PLATFORM_PUBLIC_URL ?? `https://${process.env.PLATFORM_BASE_DOMAIN ?? "u-cafe.ir"}`;
  const title = "یوکافه | سایت، منو و مدیریت یکپارچه کافه";
  const description = "سایت و منوی آنلاین، سفارش، رزرو، مدیریت مشتریان، انبار و تحلیل فروش کافه در یوکافه. امکانات و تعرفه‌ها را مقایسه کنید و کافه‌تان را بسازید.";
  return { title, description, alternates: { canonical: origin }, openGraph: { title, description, url: origin, locale: "fa_IR", type: "website", images: [{ url: `${origin}/brand/ucafe-logo-current.webp`, alt: "یوکافه" }] }, twitter: { card: "summary", title, description } };
}

export default async function HomePage() {
  const data = await loadPublicPageData();
  if (!data.isTenant) return <PlatformLanding catalog={await loadPlatformCatalog()} />;
  if (!data.context) notFound();
  if (!data.context.available || !data.site || !data.menu) return <SuspendedSite context={data.context} />;
  return <TenantStorefront context={data.context} site={data.site} menu={data.menu} ordering={data.ordering} />;
}
