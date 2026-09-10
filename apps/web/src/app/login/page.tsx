import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LoginClient } from "./login-client";
import { loadPublicPageData } from "../tenant-public-data";
import { SuspendedSite, tenantThemeStyle } from "../tenant-public";

export const metadata: Metadata = { title: "ورود مشتری | یو کافه" };

export default async function LoginPage() {
  const data = await loadPublicPageData();
  if (!data.isTenant || !data.context) notFound();
  if (!data.context.available || !data.site) return <SuspendedSite context={data.context} />;
  const logo = data.site.media.find((asset) => asset.kind === "LOGO");
  return <main className={`client-auth-page radius-${data.site.theme.radiusPreset.toLowerCase()}`} style={tenantThemeStyle(data.site)}>
    <LoginClient cafeName={data.site.name} logoUrl={logo?.sources.smallWebp} />
  </main>;
}
