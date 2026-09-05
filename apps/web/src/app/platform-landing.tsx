import type { PublicOffering } from "./tenant-public-data";
import { PlatformLandingMotion } from "./platform-landing-motion";
import { PlatformMobileNav } from "./platform-mobile-nav";
import { PlatformOrderForm } from "./platform-order-form";
import "./platform-landing.css";
import "./platform-refinements.css";

const serviceItems = [
  { title: "وب‌سایت اختصاصی", text: "یک ویترین سریع، فارسی و متناسب با هویت کافه؛ بدون قالب‌های تکراری و پیچیدگی فنی.", image: "/platform/website.svg" },
  { title: "منوی همیشه به‌روز", text: "دسته‌بندی، قیمت، موجودی و تصویر آیتم‌ها را از پنل خودتان مدیریت کنید.", image: "/platform/online-menu.svg" },
  { title: "رزرو میز", text: "مهمان زمان مناسب را پیدا می‌کند و درخواست رزرو مستقیماً به تیم کافه می‌رسد.", image: "/platform/reservations.svg" },
  { title: "میزبانی و پشتیبانی", text: "نگهداری فنی، امنیت و به‌روزرسانی‌ها با کافکساست تا شما روی تجربه مهمان تمرکز کنید.", image: "/platform/hosting-support.svg" },
];

const manifesto = "کافه شما فقط یک نشانی روی نقشه نیست؛ تجربه‌ای است که باید پیش از اولین سفارش حس شود.".split(" ");

function formatPrice(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("fa-IR").format(amount) : value;
}

export function PlatformLanding({ offering }: { offering: PublicOffering | null }) {
  return <main className="platform-home overflow-x-hidden w-full max-w-full">
    <PlatformLandingMotion />
    <header className="platform-header">
      <nav className="platform-nav" aria-label="راهبری اصلی">
        <a className="platform-brand" href="#top" aria-label="کافکسا، صفحه اصلی"><span>C</span><strong>کافکسا</strong><small>CAFEXA</small></a>
        <div className="platform-nav-links"><a href="#services">خدمات</a><a href="#process">روند همکاری</a><a href="#pricing">تعرفه</a></div>
        <a className="nav-cta" href="#request">درخواست مشاوره</a>
        <PlatformMobileNav />
      </nav>
    </header>

    <section className="platform-hero" id="top" aria-labelledby="platform-title">
      <div className="hero-orbit hero-orbit-one" /><div className="hero-orbit hero-orbit-two" />
      <div className="platform-hero-copy">
        <p className="platform-kicker">خانه دیجیتال کافه‌های حرفه‌ای</p>
        <h1 id="platform-title">کافه‌تان را جایی بسازید که <em>دیده شود.</em></h1>
        <p>کافکسا وب‌سایت، منوی آنلاین و رزرو کافه را در یک تجربه سریع و فارسی کنار هم می‌آورد؛ شما قهوه را جدی بگیرید، ما حضور دیجیتال‌تان را.</p>
        <div className="hero-actions"><a className="primary-button" href="#request">شروع همکاری</a><a className="secondary-button" href="#product">دیدن تجربه محصول</a></div>
      </div>
      <div className="hero-product" id="product" aria-label="نمایی از محصول کافکسا">
        <div className="product-browser"><div className="browser-bar"><span /><span /><span /><small>yourcafe.cafexa.com</small></div><img src="/platform/storefront-desktop.webp" alt="نمونه وب‌سایت دسکتاپ طراحی‌شده با کافکسا" /></div>
        <div className="product-phone"><div className="phone-top" /><img src="/platform/storefront-mobile.webp" alt="نمونه منوی موبایل طراحی‌شده با کافکسا" /></div>
        <div className="product-status"><i /><span><strong>رزرو جدید</strong><small>در انتظار بررسی</small></span></div>
      </div>
    </section>

    <div className="platform-marquee" aria-hidden="true"><div>{["وب‌سایت سریع", "منوی آنلاین", "رزرو میز", "پنل مدیریت", "پشتیبانی واقعی", "میزبانی امن", "وب‌سایت سریع", "منوی آنلاین", "رزرو میز", "پنل مدیریت"].map((item, index) => <span key={`${item}-${index}`}>{item}<i /></span>)}</div></div>

    <section className="platform-manifesto">
      <p>{manifesto.map((word, index) => <span className="manifesto-word" key={`${word}-${index}`}>{word}{index === 4 && <i className="inline-coffee-image" aria-hidden="true" />} </span>)}</p>
    </section>

    <section className="platform-services" id="services" aria-labelledby="services-title">
      <div className="section-heading platform-reveal"><p>همه‌چیز در یک خانه</p><h2 id="services-title">از اولین کلیک تا نشستن پشت میز</h2><span>ابزارهای لازم برای معرفی، جذب و ارتباط بهتر با مهمان‌ها؛ یکپارچه و بدون دردسر نگهداری.</span></div>
      <div className="services-accordion platform-reveal">{serviceItems.map((item, index) => <article key={item.title} tabIndex={0}><span>۰{index + 1}</span><img src={item.image} alt="" aria-hidden="true" /><div><h3>{item.title}</h3><p>{item.text}</p></div></article>)}</div>
    </section>

    <section className="platform-benefits" aria-labelledby="benefits-title">
      <div className="section-heading platform-reveal"><p>چرا کافکسا</p><h2 id="benefits-title">فناوری کمتر در ذهن شما، فرصت بیشتر برای رشد</h2></div>
      <div className="benefit-bento">
        <article className="benefit-wide platform-reveal"><span className="benefit-mark">۰۱</span><h3>اقتصادی و قابل پیش‌بینی</h3><p>به‌جای هزینه ساخت و نگهداری یک پروژه مستقل، یک سرویس کامل با تعرفه ماهانه روشن دریافت می‌کنید.</p><div className="cost-lines"><i /><i /><i /></div></article>
        <article className="benefit-compact platform-reveal"><span className="benefit-mark">۰۲</span><h3>راه‌اندازی سریع</h3><p>مسیر شروع کوتاه است؛ اطلاعات کافه را می‌گیریم و نسخه اولیه را برای بررسی آماده می‌کنیم.</p><strong>ساده، مستقیم، بدون درگیری فنی</strong></article>
        <article className="benefit-compact platform-reveal"><span className="benefit-mark">۰۳</span><h3>پشتیبانی انسانی</h3><p>پشت سرویس یک تیم واقعی است؛ برای راه‌اندازی و ادامه مسیر کنار شما می‌مانیم.</p><div className="support-pulse"><i /><span>در دسترس برای همراهی</span></div></article>
        <article className="benefit-wide platform-reveal"><span className="benefit-mark">۰۴</span><h3>ساخته‌شده برای فارسی</h3><p>از راست‌به‌چپ و موبایل تا نمایش تومان و شماره ایرانی، جزئیات از ابتدا برای مخاطب شما طراحی شده‌اند.</p><div className="rtl-demo"><span>منوی کافه</span><i>قهوه‌های گرم</i><b>تومان</b></div></article>
      </div>
    </section>

    <section className="platform-process" id="process" aria-labelledby="process-title">
      <div className="process-heading"><p>مسیر همکاری</p><h2 id="process-title">از یک گفت‌وگو تا انتشار کافه شما</h2><span>فرایند روشن است و پرداخت در این مرحله، پس از هماهنگی و به‌صورت دستی انجام می‌شود.</span></div>
      <div className="process-cards">
        <article className="demo-card"><span>۱</span><div><h3>درخواست شما</h3><p>فرم کوتاه را پر می‌کنید تا با کافه و نیازتان آشنا شویم.</p></div></article>
        <article className="demo-card"><span>۲</span><div><h3>گفت‌وگوی کوتاه</h3><p>برای مشخص‌کردن محتوا، زمان‌بندی و جزئیات همکاری با شما تماس می‌گیریم.</p></div></article>
        <article className="demo-card"><span>۳</span><div><h3>ساخت و تحویل</h3><p>خانه دیجیتال کافه آماده می‌شود و پس از تأیید شما روی نشانی اختصاصی منتشر خواهد شد.</p></div></article>
      </div>
    </section>

    <section className="platform-pricing" id="pricing" aria-labelledby="pricing-title">
      <div className="pricing-copy platform-reveal"><p>تعرفه روشن</p><h2 id="pricing-title">یک هزینه مشخص، یک سرویس کامل</h2><span>بدون هزینه راه‌اندازی. پرداخت اشتراک فعلاً پس از گفت‌وگو و به‌صورت دستی انجام می‌شود.</span></div>
      <article className="price-card platform-reveal"><div><span>پلن نقره‌ای</span><p>مناسب شروع حرفه‌ای کافه</p></div>{offering ? <><strong><b>{formatPrice(offering.priceToman)}</b> تومان<small>برای هر ماه</small></strong><ul><li>وب‌سایت اختصاصی و واکنش‌گرا</li><li>منوی آنلاین و مدیریت محتوا</li><li>رزرو میز و پنل کافه</li><li>میزبانی و پشتیبانی</li></ul><a href="#request">درخواست شروع همکاری</a></> : <><p className="price-unavailable">برای دریافت قیمت روز، درخواست خود را ثبت کنید.</p><a href="#request">دریافت مشاوره</a></>}</article>
    </section>

    <section className="platform-faq" aria-labelledby="faq-title"><div className="section-heading"><p>پیش از شروع</p><h2 id="faq-title">چند پاسخ کوتاه</h2></div><div>{[
      ["آیا ثبت درخواست هزینه دارد؟", "خیر. فرم فقط برای آشنایی و تماس اولیه است و هیچ پرداختی ایجاد نمی‌کند."],
      ["برای استفاده از کافکسا دانش فنی لازم است؟", "خیر. پنل برای کار روزمره کافه طراحی شده و راه‌اندازی فنی بر عهده ماست."],
      ["اطلاعات منو و تصاویر را چه کسی وارد می‌کند؟", "در شروع همکاری برای آماده‌سازی محتوای اولیه هماهنگ می‌شویم؛ بعد از آن می‌توانید اطلاعات را از پنل مدیریت کنید."],
      ["پرداخت اشتراک چگونه است؟", "در نسخه فعلی پرداخت پس از هماهنگی با تیم کافکسا و به‌صورت دستی انجام می‌شود."],
    ].map(([question, answer]) => <details key={question}><summary>{question}<i /></summary><p>{answer}</p></details>)}</div></section>

    <section className="platform-request" id="request" aria-labelledby="request-title"><div className="request-copy"><p>شروع یک همکاری خوب</p><h2 id="request-title">کافه‌تان را معرفی کنید؛ ما در اولین فرصت تماس می‌گیریم.</h2><span>این فرم قرارداد یا پرداخت نیست. فقط کمک می‌کند گفت‌وگوی اول دقیق‌تر و کوتاه‌تر باشد.</span></div><PlatformOrderForm /></section>

    <footer className="platform-footer"><a className="platform-brand" href="#top"><span>C</span><strong>کافکسا</strong><small>CAFEXA</small></a><p>خانه دیجیتال کافه‌های حرفه‌ای</p><div><a href="#services">خدمات</a><a href="#pricing">تعرفه</a><a href="#request">درخواست همکاری</a></div><small>© {new Date().getFullYear()} کافکسا. تمامی حقوق محفوظ است.</small></footer>
  </main>;
}
