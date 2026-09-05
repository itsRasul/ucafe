import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";
import "./media.css";
import "./tenant.css";
import "@majidh1/jalalidatepicker/dist/jalalidatepicker.min.css";

export const metadata: Metadata = {
  title: "یو کافه | ucafe",
  description: "پلتفرم حرفه‌ای وب‌سایت کافی‌شاپ‌ها",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="fa" dir="rtl"><body><script src="/vendor/jalalidatepicker.min.js" /><script dangerouslySetInnerHTML={{ __html: `window.jalaliDatepicker?.startWatch({minDate:"attr",maxDate:"attr",persianDigits:false,separatorChars:{date:"/",between:" ",time:":",targetDate:"-",targetBetween:" ",targetTime:":"}});` }} />{children}</body></html>;
}
