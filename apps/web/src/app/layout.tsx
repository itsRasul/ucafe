import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";
import "./media.css";
import "./tenant.css";

export const metadata: Metadata = {
  title: "کافکسا | Cafexa",
  description: "پلتفرم حرفه‌ای وب‌سایت کافی‌شاپ‌ها",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="fa" dir="rtl"><body>{children}</body></html>;
}
