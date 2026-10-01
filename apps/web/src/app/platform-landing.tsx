import type { PublicCatalog } from "./platform-catalog";
import { PlatformMobileNav } from "./platform-mobile-nav";
import { PlatformOrderForm } from "./platform-order-form";
import { PlatformPricing } from "./platform-pricing";
import { PlatformProductTour, ProductPreview } from "./platform-product-tour";
import { ButtonLink, SectionHeader } from "./ui/primitives";
import "./ui/tokens.css";
import "./platform-landing.css";

const pillars = [
  ["فروش و تجربه مشتری", "سایت کافه، منوی آنلاین، سفارش حضوری یا ارسال و رزرو؛ از اولین بازدید تا مراجعه بعدی."],
  ["شناخت مشتری", "تاریخچه سفارش و رزرو، ترجیحات، گروه‌بندی، وفاداری و بازخورد در پروفایل مشتری."],
  ["عملیات روزمره", "مدیریت منو، تخفیف‌ها، سفارش‌ها و مواد اولیه؛ همراه با پشتیبانی در پنل کافه."],
  ["تصمیم‌گیری با داده", "ارزش سفارش‌های تحویل‌شده، آیتم‌های پرفروش، الگوی مشتری و زمان‌های شلوغ."],
];
const faq = [
  ["آیا به برنامه‌نویس نیاز دارم؟", "برای مدیریت منو، محتوا، سفارش و رزرو از پنل یوکافه استفاده می‌کنید. ساخت و میزبانی سایت در همان پلتفرم انجام می‌شود."],
  ["سایت کافه روی چه نشانی ساخته می‌شود؟", "هنگام شروع، یک زیر دامنه اختصاصی و آزاد انتخاب می‌کنید. نشانی کامل پیش از پرداخت نمایش داده می‌شود. اتصال دامنه شخصی فعلاً ارائه نمی‌شود."],
  ["آیا بعداً می‌توانم پلنم را تغییر بدهم؟", "بله. پنل اشتراک پیش‌نمایش مبلغ و زمان تغییر را نشان می‌دهد. ارتقا پس از پرداخت تأییدشده اعمال می‌شود و کاهش پلن برای پایان دوره برنامه‌ریزی می‌شود."],
  ["اگر پرداخت لغو شود چه اتفاقی می‌افتد؟", "کافه در وضعیت پیش‌نویس باقی می‌ماند و اشتراک فعال نمی‌شود. با همان شماره می‌توانید به مسیر شروع برگردید و پرداخت را ادامه دهید."],
  ["اگر اشتراک تمام شود، اطلاعاتم حذف می‌شود؟", "خیر. پس از پایان اشتراک پولی و مهلت تنفس پلن، سایت تعلیق می‌شود اما داده‌های کافه حذف نمی‌شوند. پرداخت تأییدشده می‌تواند دسترسی را دوباره فعال کند."],
  ["سفارش، رزرو و پشتیبانی چگونه کار می‌کنند؟", "امکانات سفارش و رزرو به پلن انتخابی بستگی دارند. پرداخت سفارش مشتری فعلاً آفلاین است. درخواست پشتیبانی و پاسخ‌ها را از مرکز پشتیبانی پنل مدیریت پیگیری می‌کنید."],
  ["آیا خرید، دوره آزمایشی را فعال می‌کند؟", "خیر. خرید مستقیم یک اشتراک پولی را پس از تأیید پرداخت فعال می‌کند. دوره آزمایشی، در صورت هماهنگی، توسط تیم یوکافه شروع می‌شود."],
];

export function PlatformLanding({ catalog }: { catalog: PublicCatalog | null }) {
  return <main className="ucafe-ui platform-home" id="top">
    <a className="uc-skip" href="#main-content">رفتن به محتوای اصلی</a>
    <header className="uc-header"><nav className="uc-container uc-nav" aria-label="راهبری اصلی"><a className="uc-brand" href="#top" aria-label="یوکافه، صفحه اصلی"><img src="/brand/ucafe-logo-current.webp" alt="" width={64} height={58} /><strong>یوکافه</strong></a><div className="uc-nav-links"><a href="#features">امکانات</a><a href="#solutions">راهکارها</a><a href="#pricing">تعرفه‌ها</a><a href="#about">درباره ما</a></div><div className="uc-nav-actions"><a href="/start">ورود</a><ButtonLink href="#pricing" size="sm">شروع با یوکافه <span aria-hidden="true">←</span></ButtonLink></div><PlatformMobileNav /></nav></header>

    <section className="uc-container uc-hero" id="main-content" aria-labelledby="platform-title"><div className="uc-hero-copy"><h1 id="platform-title">کافه‌ات را<br /><em>راحت‌تر</em> مدیریت کن.<br />مشتری‌هایت را<br /><em>بهتر</em> بشناس.</h1><p>از منوی آنلاین و رزرو میز تا سفارش‌گیری، مدیریت مشتریان، انبار و تحلیل فروش؛ ابزارهای کافه‌ات، همه در یک پلتفرم.</p><div className="uc-actions"><ButtonLink href="#pricing" size="lg">ساخت کافه من <span aria-hidden="true">←</span></ButtonLink><ButtonLink href="#request" variant="outline" size="lg">مشاوره رایگان</ButtonLink></div><a className="uc-hero-tour-link" href="#features">اول با محصول آشنا شو <span aria-hidden="true">↓</span></a></div>
      <div className="uc-hero-product"><div className="uc-hero-product-label"><span>ویترین کافه + مدیریت پشت صحنه</span><span>یک یوکافه</span></div><ProductPreview compact /><div className="uc-storefront-preview"><img src="/platform/storefront-mobile.webp" width={320} height={640} alt="نمای واقعی منوی موبایل یک کافه نمونه در یوکافه" /><span>سایت کافه، همراه مشتری</span></div><div className="uc-hero-reservation"><span className="uc-status-dot" /><div><strong>درخواست رزرو</strong><small>زمان، ظرفیت و وضعیت در یک پنل</small></div></div><p className="uc-sample-label">نمای مفهومی محصول با داده‌های نمونه</p></div>
    </section>

    <div className="uc-trust"><div className="uc-container"><span>برای کافه‌های ایرانی</span><span>فارسی و راست‌به‌چپ</span><span>سایت و عملیات، یک‌جا</span><span>اشتراک با پرداخت تأییدشده</span></div></div>

    <section className="uc-section uc-container uc-problems" id="solutions" aria-labelledby="problems-title"><SectionHeader id="problems-title" title="کافه‌داری به‌اندازه کافی شلوغ هست." description="اطلاعات پراکنده، کارهای ساده را پیچیده می‌کند. وقتی هر بخش در ابزار جداگانه‌ای باشد، دیدن تصویر کامل سخت‌تر می‌شود." /><div className="uc-problem-list">{[["فروش امروز را کجا می‌بینی؟", "ارزش سفارش‌ها و آیتم‌های پرفروش، کنار هم."], ["مشتری همیشگی‌ات را چقدر می‌شناسی؟", "سابقه سفارش، رزرو و ترجیحات در یک پروفایل."], ["موجودی را از روی حدس مدیریت می‌کنی؟", "ثبت مواد اولیه، خرید و مصرف در پنل کافه."], ["رزروها بین دفتر و پیام‌ها پخش شده‌اند؟", "زمان و ظرفیت مشخص، با وضعیت قابل پیگیری."]].map(([question, answer]) => <div key={question}><h3>{question}</h3><p>{answer}</p></div>)}</div></section>

    <section className="uc-ecosystem uc-section" aria-labelledby="ecosystem-title"><div className="uc-container"><div className="uc-ecosystem-heading"><h2 id="ecosystem-title">یک کافه.<br />یک تصویر کامل.</h2><p>ویترین دیجیتال و کارهای روزمره‌ات به هم وصل‌اند. هر بخش را از همان محیط مدیریت کن؛ با امکاناتی که پلنت در اختیار تو می‌گذارد.</p></div><div className="uc-ecosystem-map"><div className="uc-ecosystem-core"><img src="/brand/ucafe-logo-current.webp" alt="یوکافه" width={104} height={94} /><strong>مرکز مدیریت کافه</strong></div><div className="uc-ecosystem-modules">{["وب‌سایت کافه", "منوی آنلاین", "سفارش‌ها", "رزرو میز", "مدیریت مشتریان", "انبار", "تحلیل فروش", "پنل مشتری", "تخفیف‌ها", "پشتیبانی"].map((name) => <span key={name}>{name}</span>)}</div></div></div></section>

    <section className="uc-section uc-container" id="features" aria-labelledby="features-title"><SectionHeader id="features-title" title="ببین در کافه‌ات چه می‌گذرد." description="پنج نگاه به کار روزمره کافه؛ از سفارش تازه تا شناخت مشتری و بررسی موجودی." /><PlatformProductTour /></section>

    <section className="uc-section uc-container uc-pillars" aria-labelledby="pillars-title"><SectionHeader id="pillars-title" title="از تجربه مهمان تا تصمیم مدیر." /><div>{pillars.map(([title, text]) => <article key={title}><h3>{title}</h3><p>{text}</p></article>)}</div></section>

    <section className="uc-before-after uc-section" aria-labelledby="comparison-title"><div className="uc-container"><h2 id="comparison-title">همان کافه؛ با اطلاعات مرتب‌تر.</h2><div className="uc-before-after-grid"><div><h3>وقتی اطلاعات پراکنده‌اند</h3><ul><li>منو در چند جای مختلف</li><li>رزرو میان تماس و پیام</li><li>سابقه مشتری دور از دسترس</li><li>گزارش‌ها در فایل‌های جداگانه</li></ul></div><div><h3>وقتی یوکافه کنار توست</h3><ul><li>منو از یک پنل مدیریت می‌شود</li><li>رزرو، زمان و وضعیت مشخص دارد</li><li>تاریخچه مشتری یک‌جا دیده می‌شود</li><li>گزارش سفارش‌ها در دسترس است</li></ul></div></div></div></section>

    <section className="uc-section uc-container uc-why" aria-labelledby="why-title"><SectionHeader id="why-title" title="جزئیات کوچک، کار روزمره ساده‌تر." /><div><article><h3>برای استفاده در ایران</h3><p>فارسی، راست‌به‌چپ، قیمت به تومان و ورود با شماره موبایل ایرانی.</p></article><article><h3>مدیریت بدون کدنویسی</h3><p>محتوا، قیمت و ساعت کاری را از پنل خودت تغییر بده.</p></article><article><h3>پشتیبانی در همان پنل</h3><p>درخواست، فایل و پاسخ‌های پشتیبانی را در یک گفت‌وگوی قابل پیگیری ببین.</p></article></div></section>

    <section className="uc-section uc-container uc-process" id="process" aria-labelledby="process-title"><SectionHeader id="process-title" title="از انتخاب پلن تا آماده‌کردن کافه." /><ol>{[["پلنت را انتخاب کن", "امکانات و تعرفه‌های روز را مقایسه کن."], ["کافه‌ات را معرفی کن", "شماره را تأیید کن؛ نام و نشانی کافه را انتخاب کن."], ["اشتراک را فعال کن", "مبلغ را بررسی کن و به درگاه پرداخت برو."], ["کافه‌ات را آماده کن", "هویت، ساعت کاری و اولین آیتم منو را در پنل تنظیم کن."]].map(([title, text], i) => <li key={title}><span aria-hidden="true">{["۱", "۲", "۳", "۴"][i]}</span><h3>{title}</h3><p>{text}</p></li>)}</ol></section>

    <section className="uc-section uc-pricing-section" id="pricing" aria-labelledby="pricing-title"><div className="uc-container"><SectionHeader id="pricing-title" title="پلنی برای نیاز امروز کافه‌ات." description="امکانات را کنار هم ببین و با انتخاب مناسب شروع کن. نام، مبلغ و دسترسی هر پلن از تنظیمات فعلی یوکافه دریافت می‌شود." /><PlatformPricing initialCatalog={catalog} /></div></section>

    <section className="uc-section uc-container uc-about" id="about" aria-labelledby="about-title"><h2 id="about-title">چرا مدیریت دیجیتال<br />یک کافه باید پیچیده باشد؟</h2><div><p>یوکافه برای کنار هم آوردن بخش‌هایی ساخته شده که هر روز با آن‌ها سروکار داری: منو، مهمان، سفارش، رزرو و مواد اولیه.</p><p>هدف ما روشن است: یک محیط فارسی و منظم که حضور آنلاین کافه و کار پشت صحنه را به هم وصل کند، تا وقتت را بیشتر صرف خود کافه کنی.</p><ButtonLink href="#request" variant="outline">با ما گفت‌وگو کن</ButtonLink></div></section>

    <section className="uc-section uc-container uc-faq" id="faq" aria-labelledby="faq-title"><SectionHeader id="faq-title" title="قبل از شروع، این‌ها را بدان." /><div>{faq.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></section>

    <section className="uc-section uc-container uc-request" id="request" aria-labelledby="request-title"><div><h2 id="request-title">هنوز مطمئن نیستی؟<br />از یک گفت‌وگو شروع کنیم.</h2><p>کمی از کافه و نیازت بگو. تیم یوکافه برای مشاوره با تو تماس می‌گیرد؛ ارسال فرم، قرارداد یا پرداخت ایجاد نمی‌کند.</p></div><PlatformOrderForm /></section>

    <section className="uc-final-cta" aria-labelledby="final-title"><div className="uc-container"><h2 id="final-title">برای روزهای منظم‌تر کافه آماده‌ای؟</h2><div className="uc-actions"><ButtonLink href="#pricing" size="lg">ساخت کافه من <span aria-hidden="true">←</span></ButtonLink><ButtonLink href="#request" variant="outline" size="lg">مشاوره رایگان</ButtonLink></div></div></section>
    <footer className="uc-footer uc-container"><a className="uc-brand" href="#top"><img src="/brand/ucafe-logo-current.webp" alt="" width={64} height={58} /><strong>یوکافه</strong></a><p>مدیریت کافه، یک‌جا.</p><nav aria-label="پیوندهای پایین صفحه"><a href="#features">امکانات</a><a href="#pricing">تعرفه‌ها</a><a href="#faq">سوالات متداول</a><a href="#request">ارتباط با ما</a></nav><small>© {new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(new Date().getFullYear())} یوکافه</small></footer>
  </main>;
}
