export class PurchaseError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function purchaseApi<T>(path: string, token?: string, body?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/backend${path}`, { method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(30000), headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch { throw new PurchaseError(0, "ارتباط برقرار نشد. اتصال اینترنت را بررسی و دوباره تلاش کنید."); }
  if (!response.ok) {
    const messages: Record<number, string> = { 400: "اطلاعات واردشده معتبر نیست. نام، نشانی و شماره را بررسی کنید.", 401: "نشست یا کد تأیید معتبر نیست. دوباره وارد شوید.", 403: "این حساب اجازه انجام این کار را ندارد.", 404: "کافه یا فاکتور برای این حساب در دسترس نیست.", 409: "اطلاعات تغییر کرده یا این نشانی قبلاً ثبت شده است. پیش‌نویس و تعرفه را دوباره بررسی کنید.", 429: "درخواست‌ها بیش از حد مجاز است. کمی صبر کنید و دوباره تلاش کنید." };
    throw new PurchaseError(response.status, messages[response.status] ?? "ارتباط با سرویس برقرار نشد. دوباره تلاش کنید.");
  }
  return response.json() as Promise<T>;
}
export function tenantAdminUrl(hostname: string) {
  const url = new URL(window.location.origin);
  url.hostname = hostname; url.pathname = "/admin"; url.search = ""; url.hash = "";
  return url.toString();
}
