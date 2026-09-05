import { TenantLandingMotion } from "./tenant-landing-motion";
import { Picture, Price, TenantFooter, TenantHeader, tenantThemeStyle, type PublicMenu, type PublicSite, type TenantContext } from "./tenant-public";

const persianDays = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

export function TenantStorefront({ context, site, menu }: { context: TenantContext; site: PublicSite; menu: PublicMenu }) {
  const style = tenantThemeStyle(site);
  const hero = site.media.find((asset) => asset.kind === "HERO");
  const gallery = site.media.filter((asset) => asset.kind === "GALLERY");
  const allItems = menu.flatMap((category) => category.items.map((item) => ({ ...item, categoryName: category.name })));
  const available = allItems.filter((item) => item.isAvailable);
  const featured = (available.filter((item) => item.isFeatured).length ? available.filter((item) => item.isFeatured) : available).slice(0, 4);
  const mapUrl = site.contact.latitude && site.contact.longitude ? `https://www.google.com/maps?q=${site.contact.latitude},${site.contact.longitude}` : null;
  const gallerySlots = (gallery.length ? gallery : [null, null, null, null, null, null]).slice(0, 6);

  return <main className={`tenant-home radius-${site.theme.radiusPreset.toLowerCase()}`} style={style} id="top">
    <a className="tenant-skip-link" href="#main-content">رفتن به محتوای اصلی</a>
    <TenantLandingMotion />
    <TenantHeader site={site} onHomePage />

    <section className="tenant-hero" id="main-content" aria-labelledby="tenant-title">
      <Picture asset={hero} fallback="hero" alt={hero ? `فضای ${site.name}` : "فضای گرم و آرام کافه"} className="tenant-hero-photo" eager />
      <div className="tenant-hero-shade" aria-hidden="true" />
      <div className="tenant-hero-copy">
        <p className="tenant-eyebrow">{context.status === "PREVIEW" ? "پیش‌نمایش کافه" : "فضایی برای طعم، گفت‌وگو و آرامش"}</p>
        <h1 id="tenant-title">{site.content.heroTitle}</h1>
        <p>{site.content.heroSubtitle ?? "طعم خوب، گفت‌وگوی گرم و لحظه‌هایی که به خاطر می‌مانند."}</p>
        <div className="tenant-actions"><a href="/menu">مشاهده منو</a><a className="secondary-action" href="/reserve">رزرو میز</a></div>
        <div className="hero-badges" aria-label="ویژگی‌های کافه"><span>قهوه تازه</span><span>فضای آرام</span><span>رزرو آنلاین</span></div>
      </div>
      <a className="hero-scroll" href="#about" aria-label="رفتن به بخش درباره ما"><span /></a>
    </section>

    <section className="tenant-about tenant-section" id="about" aria-labelledby="about-title">
      <div className="section-copy reveal">
        <p className="tenant-eyebrow">درباره کافه</p>
        <h2 id="about-title">{site.content.aboutTitle ?? `قصه‌ای برای ماندن در ${site.name}`}</h2>
        <p>{site.content.aboutBody ?? "فضایی برای قهوه‌های دقیق، گفت‌وگوهای بی‌عجله و لحظه‌هایی که ارزش ماندن دارند."}</p>
        <div className="about-points"><article><span>۰۱</span><h3>فضای دنج</h3><p>برای قرارهای دوستانه و لحظه‌های آرام روز.</p></article><article><span>۰۲</span><h3>طعم به‌یادماندنی</h3><p>انتخاب‌هایی تازه برای هر سلیقه و هر ساعت.</p></article></div>
      </div>
      <div className="about-visual reveal"><Picture asset={gallery[0] ?? hero} fallback="hero" alt={`فضای داخلی ${site.name}`} /><div className="glass-note"><strong>{site.name}</strong><span>قهوه، گفت‌وگو، آرامش</span></div></div>
    </section>

    <section className="tenant-features tenant-section" aria-labelledby="features-title">
      <header className="section-heading reveal"><p className="tenant-eyebrow">چرا اینجا</p><h2 id="features-title">جزئیاتی برای یک مکث دلچسب</h2></header>
      <div className="feature-grid"><article className="reveal"><span aria-hidden="true">☕</span><h3>قهوه با دقت</h3><p>هر فنجان با توجه به عطر، بافت و تعادل طعم آماده می‌شود.</p></article><article className="reveal"><span aria-hidden="true">✦</span><h3>حال‌وهوای گرم</h3><p>فضایی آرام برای گفت‌وگو، مطالعه و قرارهای روزمره.</p></article><article className="reveal"><span aria-hidden="true">◌</span><h3>انتخاب‌های متنوع</h3><p>منویی پویا برای سلیقه‌ها و لحظه‌های مختلف روز.</p></article><article className="reveal"><span aria-hidden="true">⌁</span><h3>رزرو ساده</h3><p>زمان مناسب را آنلاین انتخاب کنید و با خیال راحت بیایید.</p></article></div>
    </section>

    {featured.length > 0 && <section className="tenant-featured tenant-section" id="menu" aria-labelledby="featured-title"><header className="section-heading reveal"><p className="tenant-eyebrow">منتخب امروز</p><h2 id="featured-title">پیشنهاد کافه</h2></header><div className="featured-grid">{featured.map((item) => <article className="reveal" key={item.id}><a className="featured-item-link" href={`/menu?item=${encodeURIComponent(item.id)}`} aria-label={`مشاهده جزئیات ${item.name}`}><Picture asset={item.image} fallback="menu" alt={item.image ? item.name : `تصویر جایگزین برای ${item.name}`} /><div><p>{item.categoryName}</p><h3>{item.name}</h3>{item.description && <p>{item.description}</p>}<Price item={item} /></div></a></article>)}</div><a className="featured-more reveal" href="/menu">مشاهده همه منو <span aria-hidden="true">←</span></a></section>}

    <section className="tenant-gallery tenant-section" id="gallery" aria-labelledby="gallery-title"><header className="section-heading reveal"><p className="tenant-eyebrow">گالری</p><h2 id="gallery-title">حال‌وهوای کافه از نزدیک</h2></header><div className="gallery-grid">{gallerySlots.map((asset, index) => <figure className={`gallery-item gallery-item-${index + 1} reveal`} key={asset?.id ?? index}><Picture asset={asset} fallback={index % 3 === 0 ? "hero" : index % 3 === 1 ? "beans" : "extraction"} alt={asset ? `فضای ${site.name}، تصویر ${new Intl.NumberFormat("fa-IR").format(index + 1)}` : `حال‌وهوای قهوه، تصویر ${new Intl.NumberFormat("fa-IR").format(index + 1)}`} /></figure>)}</div></section>

    <section className="tenant-visit tenant-section" id="visit" aria-labelledby="visit-title"><div className="visit-copy reveal"><p className="tenant-eyebrow">دیدار با ما</p><h2 id="visit-title">برای یک فنجان خوب، منتظرتان هستیم</h2><p>{site.contact.address ?? "نشانی کافه به‌زودی ثبت می‌شود."}</p><div className="visit-links">{site.contact.phone && <a href={`tel:${site.contact.phone}`}>{site.contact.phone}</a>}{site.contact.instagramUrl && <a href={site.contact.instagramUrl} rel="noreferrer">اینستاگرام</a>}{mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer">نمایش روی نقشه ↗</a>}</div></div><div className="hours-card reveal"><p className="tenant-eyebrow">ساعات کاری</p>{site.openingHours.length ? <dl>{site.openingHours.map((item) => <div key={item.dayOfWeek}><dt>{persianDays[item.dayOfWeek]}</dt><dd>{item.isClosed ? "تعطیل" : `${item.opensAt?.slice(0, 5)} تا ${item.closesAt?.slice(0, 5)}`}</dd></div>)}</dl> : <p>ساعات کاری به‌زودی اعلام می‌شود.</p>}</div></section>

    <section className="tenant-reservation tenant-section" aria-labelledby="reservation-title"><div className="reveal"><p className="tenant-eyebrow">رزرو آنلاین</p><h2 id="reservation-title">میز بعدی شما آماده است</h2><p>تاریخ، تعداد مهمان‌ها و ساعت دلخواهتان را انتخاب کنید؛ درخواست رزرو در چند قدم ثبت می‌شود.</p></div><a href="/reserve">درخواست رزرو <span aria-hidden="true">←</span></a></section>

    <TenantFooter site={site} />
  </main>;
}
