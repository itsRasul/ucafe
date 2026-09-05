"use client";
import { ChangeEvent, useCallback, useEffect, useState } from "react";
import type { SiteApi } from "./site-editor";
type Kind = "LOGO" | "HERO" | "GALLERY";
type Asset = { id: string; kind: Kind; width: number; height: number; focalX: number; focalY: number; sortOrder: number; sources: { smallWebp: string; largeWebp: string } };
const labels: Record<Kind, string> = { LOGO: "نشان کافه", HERO: "تصویر اصلی", GALLERY: "گالری" };
const hints: Record<Kind, string> = { LOGO: "حداقل ۲۵۶×۲۵۶ پیکسل", HERO: "حداقل ۱۲۰۰×۶۷۵ پیکسل", GALLERY: "حداقل ۸۰۰×۶۰۰؛ حداکثر ۸ تصویر" };
export function MediaEditor({ api, basePath = "/tenant", privatePreview = false }: { api: SiteApi; basePath?: string; privatePreview?: boolean }) {
  const [assets, setAssets] = useState<Asset[]>([]), [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => setAssets(await api<Asset[]>(`${basePath}/media`)), [api, basePath]);
  useEffect(() => { load().catch((reason: Error) => setError(reason.message)); }, [load]);
  async function upload(kind: Kind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(kind); setError(""); setNotice(""); const body = new FormData(); body.set("kind", kind); body.set("focalX", "0.5"); body.set("focalY", "0.5"); body.set("file", file);
    try { await api(`${basePath}/media`, { method: "POST", body }); await load(); setNotice(`${labels[kind]} با نسخه‌های بهینه منتشر شد.`); } catch (reason) { setError((reason as Error).message); } finally { setBusy(""); event.target.value = ""; }
  }
  async function update(asset: Asset, patch: Partial<Pick<Asset, "focalX" | "focalY" | "sortOrder">>) {
    setBusy(asset.id); setError(""); try { await api(`${basePath}/media/${asset.id}`, { method: "PATCH", body: JSON.stringify(patch) }); await load(); setNotice("تنظیم تصویر ذخیره شد."); } catch (reason) { setError((reason as Error).message); } finally { setBusy(""); }
  }
  async function remove(asset: Asset) {
    if (!confirm(`حذف ${labels[asset.kind]}؟`)) return;
    setBusy(asset.id); setError(""); try { await api(`${basePath}/media/${asset.id}`, { method: "DELETE" }); await load(); setNotice("تصویر حذف شد؛ چیدمان عمومی به حالت امن بازگشت."); } catch (reason) { setError((reason as Error).message); } finally { setBusy(""); }
  }
  return <fieldset><legend>تصاویر سایت</legend><p className="fieldset-help">فقط JPEG، PNG یا WebP تا ۸ مگابایت پذیرفته می‌شود. فایل‌ها خودکار به WebP و AVIF تبدیل می‌شوند.</p>{error && <p className="admin-message error" role="alert">{error}</p>}{notice && <p className="admin-message success" role="status">{notice}</p>}<div className="media-slots">{(["LOGO", "HERO", "GALLERY"] as Kind[]).map((kind) => <section className="media-slot" key={kind}><header><div><strong>{labels[kind]}</strong><small>{hints[kind]}</small></div><label className="media-upload">{busy === kind ? "در حال پردازش…" : kind === "GALLERY" ? "افزودن تصویر" : "انتخاب تصویر"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={(event) => upload(kind, event)} /></label></header><div className="media-grid">{assets.filter((asset) => asset.kind === kind).map((asset) => <article key={asset.id}><MediaPreview asset={asset} api={api} path={privatePreview ? `${basePath}/media/${asset.id}/small-webp` : undefined} /><div className="media-controls"><label>تمرکز افقی<input type="range" min="0" max="1" step="0.05" value={asset.focalX} onChange={(event) => update(asset, { focalX: Number(event.target.value) })} /></label><label>تمرکز عمودی<input type="range" min="0" max="1" step="0.05" value={asset.focalY} onChange={(event) => update(asset, { focalY: Number(event.target.value) })} /></label>{kind === "GALLERY" && <label>ترتیب<input type="number" min="0" max="7" value={asset.sortOrder} onChange={(event) => update(asset, { sortOrder: Number(event.target.value) })} /></label>}<button type="button" className="danger" disabled={Boolean(busy)} onClick={() => remove(asset)}>حذف</button></div></article>)}</div></section>)}</div></fieldset>;
}

function MediaPreview({ asset, api, path }: { asset: Asset; api: SiteApi; path?: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!path) return;
    let active = true, objectUrl = "";
    api<Blob>(path).then(blob => {
      if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, path]);
  if (path && !url) return <p role="status">{error ? "پیش‌نمایش تصویر بارگذاری نشد." : "در حال بارگذاری تصویر…"}</p>;
  return <img src={path ? url : asset.sources.smallWebp} alt={labels[asset.kind]} style={{ objectPosition: `${asset.focalX * 100}% ${asset.focalY * 100}%` }} />;
}
