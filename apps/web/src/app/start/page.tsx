import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPlatformCatalog, loadPublicPageData } from "../tenant-public-data";
import { PurchaseClient } from "./purchase-client";
import "../ui/tokens.css";
import "../platform-landing.css";
import "./purchase.css";

export const metadata: Metadata = { title: "ساخت کافه | یوکافه", robots: { index: false, follow: false } };
export default async function StartPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  if ((await loadPublicPageData()).isTenant) notFound();
  const { plan } = await searchParams;
  return <PurchaseClient catalog={await loadPlatformCatalog()} selectedPlan={plan} />;
}
