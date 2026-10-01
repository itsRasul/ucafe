import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicPageData } from "../../tenant-public-data";
import { PurchaseResult } from "./purchase-result";
import "../../ui/tokens.css";
import "../../platform-landing.css";
import "../purchase.css";

export const metadata: Metadata = { title: "نتیجه اشتراک | یوکافه", robots: { index: false, follow: false } };
export default async function ResultPage({ searchParams }: { searchParams: Promise<{ slug?: string; intentId?: string }> }) {
  if ((await loadPublicPageData()).isTenant) notFound();
  const params = await searchParams;
  return <PurchaseResult slug={params.slug ?? ""} intentId={params.intentId ?? ""} />;
}
