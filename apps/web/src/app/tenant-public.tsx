import type { CSSProperties } from "react";
import { BrandLogo } from "./brand-logo";
import { TenantMobileNav } from "./tenant-mobile-nav";

export type TenantContext = {
  available: boolean;
  slug: string;
  status: "PREVIEW" | "ACTIVE" | "SUSPENDED";
  unavailable?: { code: string; title: string; message: string };
};

type ImageSources = { smallAvif: string; largeAvif: string; smallWebp: string; largeWebp: string };
export type MediaAsset = {
  id: string;
  kind: "LOGO" | "HERO" | "GALLERY";
  width?: number;
  height?: number;
  focalX: number;
  focalY: number;
  sources: ImageSources;
};
export type MenuImage = Omit<MediaAsset, "kind"> & { kind: "MENU_ITEM" };
export type PublicMenuVariant = { id: string; name: string; priceToman: string; isDefault: boolean; isAvailable: boolean };
export type PublicMenuItem = {
  id: string;
  name: string;
  description: string | null;
  basePriceToman: string | null;
  isAvailable: boolean;
  isFeatured: boolean;
  image: MenuImage | null;
  variants: PublicMenuVariant[];
};
export type PublicMenu = Array<{ id: string; name: string; description: string | null; items: PublicMenuItem[] }>;
export type PublicSite = {
  name: string;
  content: { heroTitle: string; heroSubtitle: string | null; aboutTitle: string | null; aboutBody: string | null; announcementText: string | null };
  theme: { primaryColor: string; primaryForeground: string; secondaryColor: string; secondaryForeground: string; accentColor: string; accentForeground: string; headingFont?: string; bodyFont?: string; radiusPreset: string };
  contact: { phone: string | null; address: string | null; latitude: string | null; longitude: string | null; instagramUrl: string | null };
  openingHours: Array<{ dayOfWeek: number; isClosed: boolean; opensAt: string | null; closesAt: string | null }>;
  media: MediaAsset[];
};

export function tenantThemeStyle(site: PublicSite) {
  return {
    "--tenant-primary": site.theme.primaryColor,
    "--tenant-on-primary": site.theme.primaryForeground,
    "--tenant-surface": site.theme.secondaryColor,
    "--tenant-on-surface": site.theme.secondaryForeground,
    "--tenant-accent": site.theme.accentColor,
    "--tenant-on-accent": site.theme.accentForeground,
    "--tenant-heading-font": "Vazir",
    "--tenant-body-font": "Vazir",
  } as CSSProperties;
}

export function formatToman(value: string) {
  return `${new Intl.NumberFormat("fa-IR").format(Number(value))} تومان`;
}

function fallbackSources(name: string) {
  return { avif: `/storefront/${name}-fallback.avif`, webp: `/storefront/${name}-fallback.webp` };
}

export function Picture({ asset, fallback, alt, className, eager = false }: { asset?: MediaAsset | MenuImage | null; fallback: string; alt: string; className?: string; eager?: boolean }) {
  const local = fallbackSources(fallback);
  return <picture className={className}><source type="image/avif" srcSet={asset ? `${asset.sources.smallAvif} 640w, ${asset.sources.largeAvif} 1200w` : local.avif} /><source type="image/webp" srcSet={asset ? `${asset.sources.smallWebp} 640w, ${asset.sources.largeWebp} 1200w` : local.webp} /><img src={asset?.sources.largeWebp ?? local.webp} alt={alt} loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : "auto"} width="1200" height="900" style={asset ? { objectPosition: `${asset.focalX * 100}% ${asset.focalY * 100}%` } : undefined} /></picture>;
}

export function Price({ item }: { item: PublicMenuItem }) {
  const variants = item.variants.filter((variant) => variant.isAvailable);
  if (variants.length) return <span>{variants.map((variant) => `${variant.name} ${formatToman(variant.priceToman)}`).join("، ")}</span>;
  return item.basePriceToman ? <strong>{formatToman(item.basePriceToman)}</strong> : <span>قیمت به‌زودی</span>;
}

export function TenantHeader({ site, onHomePage = false }: { site: PublicSite; onHomePage?: boolean }) {
  const logo = site.media.find((asset) => asset.kind === "LOGO");
  const prefix = onHomePage ? "" : "/";
  return <header className="tenant-header">
    {site.content.announcementText && <div className="tenant-announcement">{site.content.announcementText}</div>}
    <nav className="tenant-nav" aria-label="ناوبری اصلی">
      <a className="tenant-brand" href="/" aria-label={`صفحه اصلی ${site.name}`}>
        {logo ? <Picture asset={logo} fallback="menu" alt={`نشان ${site.name}`} className="tenant-logo" eager /> : <BrandLogo className="tenant-brand-logo" variant="mark" />}
        <span><strong>{site.name}</strong><small>ucafe coffee house</small></span>
      </a>
      <div className="tenant-nav-links"><a href={`${prefix}#about`}>درباره ما</a><a href="/menu" aria-current={onHomePage ? undefined : "page"}>منو</a><a href={`${prefix}#gallery`}>گالری</a><a href={`${prefix}#visit`}>تماس و نشانی</a></div>
      <a className="nav-reserve" href="/reserve">رزرو میز</a>
      <TenantMobileNav sectionPrefix={prefix} />
    </nav>
  </header>;
}

export function TenantFooter({ site }: { site: PublicSite }) {
  const logo = site.media.find((asset) => asset.kind === "LOGO");
  return <footer className="tenant-footer"><div className="footer-grid"><div className="footer-brand">{logo ? <Picture asset={logo} fallback="menu" alt={`نشان ${site.name}`} /> : <BrandLogo className="tenant-footer-logo" />}<strong>{site.name}</strong><p>{site.content.heroSubtitle ?? "یک فنجان دقیق، یک مکث واقعی."}</p></div><nav aria-label="دسترسی سریع"><strong>دسترسی سریع</strong><a href="/#about">درباره ما</a><a href="/menu">منو</a><a href="/#gallery">گالری</a><a href="/reserve">رزرو میز</a></nav><div><strong>تماس با ما</strong>{site.contact.phone && <a href={`tel:${site.contact.phone}`}>{site.contact.phone}</a>}{site.contact.address && <address>{site.contact.address}</address>}</div></div><div className="footer-base"><span>ساخته‌شده با ucafe</span><a href="#top">بازگشت به بالا ↑</a></div></footer>;
}

export function SuspendedSite({ context }: { context: TenantContext }) {
  return <main className="unavailable-shell"><section className="unavailable-card" aria-labelledby="unavailable-title"><BrandLogo className="unavailable-logo" /><p className="eyebrow">ucafe · یو کافه</p><h1 id="unavailable-title">{context.unavailable?.title ?? "در حال حاضر سایت مدنظر در دسترس نمی‌باشد"}</h1><p className="intro">{context.unavailable?.message ?? "لطفاً بعداً امتحان نمایید."}</p><div className="quiet-divider" aria-hidden="true" /><p className="quiet-note">از شکیبایی شما سپاسگزاریم</p></section></main>;
}
