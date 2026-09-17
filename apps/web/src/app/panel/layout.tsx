import { notFound } from "next/navigation";
import { loadPublicPageData } from "../tenant-public-data";
import { SuspendedSite, tenantThemeStyle } from "../tenant-public";
import { PanelShell } from "./panel-client";
import "./panel.css";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const data = await loadPublicPageData();
  if (!data.isTenant || !data.context) notFound();
  if (!data.context.available || !data.site) return <SuspendedSite context={data.context} />;
  const logo = data.site.media.find((asset) => asset.kind === "LOGO");
  return <div className={`client-panel-theme radius-${data.site.theme.radiusPreset.toLowerCase()}`} style={tenantThemeStyle(data.site)}>
    <PanelShell cafeName={data.site.name} logoUrl={logo?.sources.smallWebp}>{children}</PanelShell>
  </div>;
}
