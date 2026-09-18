# Multi-tenancy

> Never access a tenant-owned resource by resource ID alone when tenant scope is required. Never trust tenant identity supplied by an arbitrary client.

## Tenant identity

A `coffee_shop` is the tenant root. Tenant-owned tables carry `coffee_shop_id` directly or inherit ownership through a tenant-owned parent such as a branch, order, or subscription.

Provisioning creates one primary branch and one active primary platform subdomain (`<slug>.<PLATFORM_BASE_DOMAIN>`). The schema represents preview/custom domains, but the current product has no custom-domain provisioning or verification workflow.

## Host resolution

`TenantContextMiddleware` normalizes the request host, looks up an active `domains` row whose cafe is preview/active/suspended, reconciles subscription availability, and attaches tenant ID, slug, status, locale, timezone, hostname, and domain type.

- Invalid or unknown host: no context; tenant guards return 404.
- Suspended public tenant: context exists; public availability guard returns HTTP 423 with stable code `TENANT_SUSPENDED`.
- Draft/archived cafes are not resolved publicly.

## Web-to-API forwarding

SSR sends the external host to the internal API. Browser calls go to Next.js `/api/backend/[...path]`, which forwards the original host in `x-ucafe-tenant-host` together with `x-ucafe-proxy-secret`.

The API accepts that override only when `x-ucafe-proxy-secret` matches `INTERNAL_PROXY_SECRET` using a constant-time comparison. Otherwise it ignores the override and uses the direct request host.

Production reverse proxies must strip both internal headers from public traffic, preserve the real `Host`, and keep web/API on a private network. The shared secret authenticates the web proxy; it does not replace user/client authentication.

## Query boundaries

- Tenant controllers derive `coffeeShopId` from resolved context rather than DTOs.
- Services include tenant scope in reads, updates, deletes, and joins (`id` plus `coffeeShopId` where relevant).
- Client access-token claims include `cafe`; the guard requires that claim, session, client, and resolved host to match.
- Tenant administrative authorization requires an active membership for the resolved cafe and scope-compatible tenant roles/permissions.
- Platform authority is separate and never falls back to tenant membership.

## Database enforcement

Migrations add scoped uniqueness and triggers for important cross-tenant relations, including memberships/roles, menu variants, reservations, media, payment intents, clients/sessions/addresses, orders/items, and notification ownership. These checks complement scoped application queries; they do not make unscoped application reads acceptable.

Notable uniqueness includes hostname globally, one active primary branch/domain per cafe, client phone per cafe, and order/checkout idempotency within tenant scope.

## Client ownership

`clients` are cafe-scoped customer identities, distinct from platform/tenant administrative `users`. Addresses, client sessions, orders, and reservations must match both the client and tenant. Client order/reservation detail additionally filters by `clientId`, so another client cannot fetch a resource by UUID.

## Media isolation

Metadata is tenant-scoped. Object keys are generated as `tenants/<coffeeShopId>/<assetId>/<variant>.<format>` and never accepted from user input. The bucket is private; public delivery resolves the current tenant and requires the asset's `coffee_shop_id` to match.

## Change checklist

- Resolve tenant from host; do not add tenant IDs to public/client input contracts.
- Scope every repository/query-builder operation and relation traversal.
- Add a database constraint/trigger when a cross-table tenant mismatch would be security-significant.
- Test a valid tenant, wrong tenant, missing tenant, and arbitrary resource ID.
- Keep public errors neutral and avoid leaking whether a resource exists in another tenant.

