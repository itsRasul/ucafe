export const platformStorageKey = "ucafe_platform_access";

export async function platformRaw<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(!(init?.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (response.ok && response.headers.get("content-type")?.startsWith("image/")) return await response.blob() as T;
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(Array.isArray(body.message) ? body.message[0] : body.message || "ارتباط با سرور برقرار نشد."), { status: response.status, data: body });
  return body as T;
}
