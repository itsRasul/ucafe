import { normalizeIranianMobile } from "../auth/iran-phone.util";

export function normalizeCrmName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function normalizeCrmComparable(value: string): string {
  return normalizeCrmName(value).toLocaleLowerCase("en-US");
}

export function normalizeCrmWebsite(value: string | null | undefined): { website: string | null; host: string | null } {
  if (!value?.trim()) return { website: null, host: null };
  const raw = value.trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error("Website URL is invalid");
  url.hash = "";
  url.search = "";
  if (url.pathname === "/") url.pathname = "";
  const host = url.hostname.toLowerCase();
  return { website: `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/$/, "")}`, host };
}

export function normalizeInstagramHandle(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  let handle = value.trim().replace(/^@/, "");
  if (/^https?:\/\//i.test(handle)) {
    const url = new URL(handle);
    if (!/^(www\.)?instagram\.com$/i.test(url.hostname)) throw new Error("Instagram URL is invalid");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1) throw new Error("Enter an Instagram profile URL or handle");
    handle = parts[0]!;
  }
  handle = handle.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) throw new Error("Instagram handle is invalid");
  return handle;
}

export function normalizeContactPhone(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return normalizeIranianMobile(value);
}

export function normalizeContactEmail(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim().toLowerCase();
}

export function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}
