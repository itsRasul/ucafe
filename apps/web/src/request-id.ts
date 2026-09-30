const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSafeRequestId(value: unknown): value is string {
  return typeof value === "string" && uuidV4.test(value);
}

export function canonicalRequestId(value?: string | null): string {
  return isSafeRequestId(value) ? value.toLowerCase() : globalThis.crypto.randomUUID();
}
