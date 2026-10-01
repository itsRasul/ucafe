"use client";

import { KeyboardEvent, useRef, useState } from "react";
import { toman } from "./platform-catalog";

const tour = [
  { key: "sales", label: "فروش", title: "از منو تا سفارش، یک مسیر روشن.", text: "مشتری منو را می‌بیند و سفارش می‌دهد؛ تیم شما وضعیت سفارش را در همان پنل پیگیری می‌کند.", benefits: ["منوی قابل ویرایش با قیمت و موجودی", "سفارش برای دریافت حضوری یا ارسال", "تخفیف، کد تخفیف و سابقه سفارش"] },
  { key: "crm", label: "مشتریان", title: "مشتری‌ها فقط یک شماره تلفن نیستند.", text: "سابقه سفارش و رزرو را کنار ترجیحات، یادداشت‌ها و بازخورد مشتری ببینید.", benefits: ["پروفایل ۳۶۰ درجه و تاریخچه تعامل", "گروه‌بندی، برچسب و یادآوری داخلی", "امتیاز وفاداری و ثبت بازخورد"] },
  { key: "inventory", label: "انبار", title: "موجودی را پیش از تمام‌شدن ببینید.", text: "مواد اولیه، خرید و گردش موجودی را ثبت کنید و مصرف دستور تهیه را به سفارش‌های کافه متصل کنید.", benefits: ["مواد اولیه و دستور تهیه", "ورود، خروج و شمارش موجودی", "خرید و بهای مواد مصرفی"] },
  { key: "reservations", label: "رزرو", title: "برای هر مهمان، زمان و ظرفیت مشخص.", text: "مشتری زمان‌های قابل رزرو را می‌بیند؛ شما درخواست‌ها را با ظرفیت و ساعت کاری کافه هماهنگ می‌کنید.", benefits: ["زمان‌های رزرو بر اساس ساعت کاری", "کنترل ظرفیت و تعداد مهمان", "ثبت و تأیید رزرو از پنل کافه"] },
  { key: "analytics", label: "تحلیل", title: "تصمیم بعدی را با داده بگیرید.", text: "ارزش سفارش‌های تحویل‌شده، آیتم‌های پرفروش و ساعت‌های شلوغ را در بازه دلخواه بررسی کنید.", benefits: ["مقایسه بازه‌های زمانی", "تحلیل محصول و مشتری", "تعداد سفارش و میانگین ارزش سفارش"] },
] as const;

export type PreviewKind = typeof tour[number]["key"];

export function ProductPreview({ kind = "analytics", compact = false }: { kind?: PreviewKind; compact?: boolean }) {
  return <div className={`uc-product-preview ${compact ? "is-compact" : ""}`}>
    <div className="uc-product-bar"><strong>کافه نمونه</strong><span className="uc-badge">داده نمایشی</span></div>
    <div className="uc-preview-body">
      {kind === "analytics" && <><div className="uc-preview-title"><strong>نمای کلی فروش</strong><span>۷ روز گذشته</span></div><div className="uc-preview-metrics"><div><span>ارزش سفارش‌های تحویل‌شده</span><strong>{toman("2480000")} <small>تومان</small></strong></div><div><span>سفارش تحویل‌شده</span><strong>۲۴ <small>سفارش</small></strong></div></div><figure className="uc-chart"><div className="uc-bars">{[180000, 420000, 260000, 360000, 520000, 300000, 440000].map((value, i) => <div key={i}><span style={{ height: `${value / 6000}px` }} aria-hidden="true" /><small>{["ش", "ی", "د", "س", "چ", "پ", "ج"][i]}</small><span className="uc-sr-only">{["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"][i]}: {toman(String(value))} تومان</span></div>)}</div><figcaption>ارزش سفارش‌های تحویل‌شده؛ معادل وجه وصول‌شده نیست.</figcaption></figure><div className="uc-preview-row"><span>آیتم پرفروش این بازه</span><strong>لاته · ۸ سفارش</strong></div></>}
      {kind === "sales" && <><div className="uc-preview-title"><strong>سفارش‌های کافه</strong><span>دریافت حضوری</span></div>{[["سفارش ۱۰۲۴", "لاته × ۲", "در حال آماده‌سازی"], ["سفارش ۱۰۲۵", "اسپرسو × ۱", "آماده تحویل"], ["سفارش ۱۰۲۶", "چای × ۲", "در انتظار بررسی"]].map(([title, detail, state]) => <div className="uc-order-row" key={title}><div><strong>{title}</strong><small>{detail}</small></div><span>{state}</span></div>)}<p className="uc-preview-note">پرداخت سفارش مشتری در نسخه فعلی به‌صورت آفلاین است.</p></>}
      {kind === "crm" && <><div className="uc-preview-title"><strong>پروفایل مشتری نمونه</strong><span>نمای ۳۶۰ درجه</span></div><div className="uc-preview-metrics"><div><span>سفارش تحویل‌شده</span><strong>۸</strong></div><div><span>رزرو تکمیل‌شده</span><strong>۳</strong></div></div><div className="uc-preview-row"><span>ترجیح ثبت‌شده</span><strong>قهوه بدون شکر</strong></div><div className="uc-preview-row"><span>برچسب</span><span className="uc-badge">مشتری همیشگی</span></div><div className="uc-preview-row"><span>یادآوری داخلی</span><strong>پیگیری بازخورد اخیر</strong></div><p className="uc-preview-note">شناخت و پیگیری در پنل؛ ارسال کمپین پیامکی فعال نیست.</p></>}
      {kind === "inventory" && <><div className="uc-preview-title"><strong>موجودی مواد اولیه</strong><span>انبار اصلی</span></div>{[["دانه قهوه", "۶٫۵ کیلوگرم", "موجود"], ["شیر", "۱۲ لیتر", "موجود"], ["سیروپ وانیل", "۱ لیتر", "نیاز به بررسی"]].map(([name, amount, state]) => <div className="uc-order-row" key={name}><div><strong>{name}</strong><small>{amount}</small></div><span>{state}</span></div>)}<div className="uc-preview-row"><span>آخرین عملیات</span><strong>ثبت خرید مواد اولیه</strong></div></>}
      {kind === "reservations" && <><div className="uc-preview-title"><strong>رزروهای امروز</strong><span>شعبه اصلی</span></div>{[["۱۸:۳۰", "۲ مهمان", "تأییدشده"], ["۱۹:۰۰", "۴ مهمان", "در انتظار بررسی"], ["۲۰:۰۰", "۲ مهمان", "تأییدشده"]].map(([time, guests, state]) => <div className="uc-order-row" key={time}><div><strong>{time}</strong><small>{guests}</small></div><span>{state}</span></div>)}<p className="uc-preview-note">زمان‌ها و ظرفیت از تنظیمات کافه تعیین می‌شوند.</p></>}
    </div>
  </div>;
}

export function PlatformProductTour() {
  const [selected, setSelected] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const item = tour[selected]!;
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowLeft" ? (index + 1) % tour.length : event.key === "ArrowRight" ? (index + tour.length - 1) % tour.length : event.key === "Home" ? 0 : event.key === "End" ? tour.length - 1 : null;
    if (next !== null) { event.preventDefault(); setSelected(next); buttons.current[next]?.focus(); }
  }
  return <div className="uc-tour">
    <div role="tablist" aria-label="آشنایی با امکانات" className="uc-tour-tabs">{tour.map((tab, index) => <button key={tab.key} ref={(node) => { buttons.current[index] = node; }} type="button" role="tab" id={`tour-tab-${tab.key}`} aria-controls={`tour-panel-${tab.key}`} aria-selected={index === selected} tabIndex={index === selected ? 0 : -1} onKeyDown={(event) => navigate(event, index)} onClick={() => setSelected(index)}>{tab.label}</button>)}</div>
    {tour.map((tab, index) => <div key={tab.key} role="tabpanel" id={`tour-panel-${tab.key}`} aria-labelledby={`tour-tab-${tab.key}`} tabIndex={0} hidden={selected !== index} className="uc-tour-panel"><div><h3>{tab.title}</h3><p>{tab.text}</p><ul>{tab.benefits.map((benefit) => <li key={benefit}><span aria-hidden="true" className="uc-check" />{benefit}</li>)}</ul><a href="#pricing">امکانات هر پلن را مقایسه کنید <span aria-hidden="true">←</span></a></div><ProductPreview kind={tab.key} /></div>)}
    <p className="uc-tour-caption">{item.label} در یوکافه · نمایش مفهومی امکانات پیاده‌سازی‌شده با داده‌های نمونه؛ دسترسی هر کافه به پلن آن بستگی دارد.</p>
  </div>;
}
