# Frontend

`apps/web` is a Next.js 16 App Router application on React 19. It is Persian-first (`lang="fa"`, `dir="rtl"`), responsive, and uses one deployment for the platform and all tenant hosts.

## Route surfaces

- `/`: platform marketing page on the base host; resolved tenant storefront on tenant hosts; controlled unavailable state for suspended tenants.
- `/menu`, `/cart`, `/checkout`, `/checkout/result`, `/reserve`, `/login`: tenant customer journeys.
- `/panel`: authenticated client overview, profile, orders/detail, and reservations/detail.
- `/admin`: tenant owner/staff overview, site/media, menu, orders, reservations, analytics, subscription, invoices, and payment result.
- `/platform`: separate platform operations surface.
- `/api/backend/[...path]`: same-origin API proxy.
- `/health`: web liveness.

Tenant-only server pages call `loadPublicPageData` and return 404 outside a valid tenant host. The base host never receives tenant content by URL parameter.

## Rendering and data flow

The platform landing and tenant storefront shell/data are server-rendered. `apps/web/src/app/tenant-public-data.ts` uses the external host against `API_INTERNAL_URL` to resolve context and fetch site/menu/ordering in parallel. React `cache` deduplicates a request's loads.

Client components handle sessions, OTP, cart state, forms, admin workspaces, panel interactions, motion, toasts, and the Jalali picker. They call only `/api/backend`; the proxy forwards method, query, body, authorization, and cookies, and rewrites refresh-cookie paths.

Do not move ordinary static/public content to client fetching without a measured need. Do not call the private API URL from browser code.

## Sessions

Admin and client session providers are separate. Both keep short-lived access tokens in browser session state and refresh through same-origin HttpOnly cookies. Checkout/reservation/login reuse the parent client session; the admin shell exposes navigation based on the access projection but relies on API guards for security.

## Tenant and design conventions

- Tenant site content/theme/media from the API remains authoritative; uploaded cafe logo takes precedence over platform fallback branding.
- The storefront is one curated template with controlled CSS variables—not arbitrary tenant CSS or a page builder.
- Owner and platform admin have separate CSS/shells and permission-aware navigation.
- Self-hosted Vazir fonts support the Persian interface. Keep touch targets, labels, focus states, empty/loading/error/success states, and mobile layouts usable.
- Motion uses CSS/GSAP/Three only where already established. Every effect must retain complete content under `prefers-reduced-motion` and avoid layout/scroll trapping.
- Security headers are configured in `apps/web/next.config.ts`; account for CSP before adding remote images/scripts/connections.

## Dates and money

Reservation inputs display Jalali via the installed picker and conversion helper, but submit ISO `YYYY-MM-DD`. Do not change the backend/storage calendar contract accidentally. Render integer toman values with Persian-friendly formatting; never do checkout pricing in the frontend as an authority.

## Adding UI

Reuse existing session, OTP, API, form, tenant-data, and shell patterns before adding another abstraction or dependency. Read the repository-local Next.js documentation required by `apps/web/AGENTS.md` because the installed Next version may differ from remembered APIs.
