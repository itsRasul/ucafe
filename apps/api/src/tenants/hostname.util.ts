const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeHostname(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Hostname is required");

  let hostname: string;
  try {
    hostname = new URL(`http://${input}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new Error("Hostname is invalid");
  }

  if (!HOSTNAME_PATTERN.test(hostname)) throw new Error("Hostname is invalid");
  return hostname;
}

export function buildTenantHostname(slug: string, baseDomain: string): string {
  return normalizeHostname(`${slug}.${normalizeHostname(baseDomain)}`);
}
