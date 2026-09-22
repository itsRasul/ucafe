# ucafe product requirements

This is the current product source of truth. Technical implementation belongs in the linked architecture and domain documents; historical reasoning belongs in [DECISIONS.md](DECISIONS.md).

## Product

ucafe (یو کافه) is a shared, multi-tenant SaaS for Iranian coffee shops. It gives each cafe a Persian-first public website and operational panels without deploying a separate application per tenant.

The product is aimed at independent cafes that need a professional storefront, editable menu, online ordering, reservations, customer self-service, and subscription-based access with minimal technical administration.

## People and surfaces

- **Visitor:** views the platform landing page or a tenant storefront, menu, location, hours, and available services.
- **Cafe client/customer:** has a cafe-scoped OTP account, saved addresses, order and reservation history, and profile management. A phone can identify separate client records at different cafes.
- **Cafe owner/staff:** is an administrative `User` connected to a cafe by membership and tenant roles. The `/admin` panel covers site, media, menu, orders, reservations, subscription, and invoices according to permissions.
- **Platform operator:** uses the separate `/platform` panel to provision cafes, manage subscriptions and plans, inspect invoices, manage users/roles, read audit history, and review consultation requests according to platform permissions.

## Current capabilities

### Platform and tenant sites

- The platform host presents ucafe marketing and a consultation/request form.
- Active tenant hostnames present one curated, responsive RTL storefront using tenant content, theme settings, menu, private media variants, hours, location, and enabled service calls to action.
- Suspended tenants retain their data but receive a controlled unavailable page.
- Provisioning creates the cafe, primary branch, platform subdomain, default website/reservation settings, and optional owner invitation in one transaction.

### Menu and content

- Owners manage approved site identity, story, theme, contact, location, opening hours, logo, hero, gallery, categories, items, variants, prices, availability, featured state, and menu-item images.
- Media is decoded and transformed into fixed AVIF/WebP variants. The object bucket is private; public bytes are streamed through the tenant-aware API.

### Ordering

- Plan-gated online ordering supports a cart and checkout, pickup or courier delivery, saved/new addresses, customer notes, offline payment, customer order history, and tenant-admin order processing.
- The server re-resolves every item/variant and calculates current prices. Customer-submitted totals are never trusted.
- Customer order payment is not implemented; the current order payment method is offline only.

### Reservations

- Plan-gated reservations derive slots from the primary branch's opening hours and configurable interval, duration, party, lead-time, advance-window, capacity, reminder, and owner-alert settings.
- Clients create pending reservations after cafe-scoped OTP authentication and can view their own history/detail.
- Staff can create immediately confirmed reservations for existing or new cafe clients, edit active bookings, and apply valid status transitions.

### Accounts and administration

- Administrative users and cafe clients are deliberately separate identity domains; see [AUTHENTICATION.md](AUTHENTICATION.md).
- Platform and tenant permissions are database-backed and server-enforced; see [AUTHORIZATION.md](AUTHORIZATION.md).
- Client panel routes cover overview, profile/phone change, addresses, orders, and reservations.
- Owner and platform panels are responsive Persian RTL interfaces; frontend visibility is convenience, not authorization.

### Plans, subscriptions, invoices, and payments

- Plans store editable name, description, price, billing length, display rank, status, trial/grace days, highlighted features, and typed feature values. Seed values are defaults, not permanent commercial constants.
- Tenant subscriptions support virtual trial presentation, authoritative prepaid entitlement periods, grace, suspension/reactivation, immediate prorated upgrades, and scheduled downgrades.
- Tenant plan catalog and preview endpoints decide the allowed action and price. A payment intent is the immutable owner/platform-facing invoice; successful verified settlement records the payment, entitlement, lifecycle projection, cafe state, and notification atomically.
- Zarinpal request/verify code exists, while real production acceptance still requires external credentials and testing.

### Notifications

- OTP uses sms.ir verify templates in production.
- An encrypted durable outbox covers consultation, order, reservation, reminder, subscription, and payment events with deduplication and bounded retries.
- Delivery is asynchronous but currently dispatched inside each API process, not the worker.

## Product constraints

- One shared database and codebase; tenant isolation is mandatory.
- Public flows use one primary branch even though branch/domain entities allow broader future models.
- The public design is curated; arbitrary CSS, page builders, and unrestricted templates are not supported.
- Toman is the application money unit; Zarinpal conversion to rial occurs only at the provider boundary.
- Persian/RTL and mobile use are primary. Reservation UI dates are Jalali, while API/database dates remain Gregorian ISO.
- Phone numbers and other sensitive values must not appear in public projections or logs.

## Not currently supported

- recurring or automatic subscription billing, refunds UI, and customer online order payment
- customer self-service reservation cancellation
- physical table/floor assignment and overnight opening-hour ranges
- an operational custom-domain onboarding/verification workflow
- full multi-branch public/customer UX, multiple storefront templates, page building, advanced analytics, reviews, social ingestion, and marketing campaigns
- horizontally coordinated notification workers or general background queues

## Non-functional requirements

- Server-side tenant isolation, authorization, pricing, payment verification, and subscription feature checks are authoritative.
- External input is DTO-validated; schema changes are migration-only; multi-row financial/capacity writes are transactional.
- Public UI must be responsive, keyboard-usable, RTL-correct, compatible with reduced motion, and server-rendered where practical.
- Production must fail closed on simulated providers, use HTTPS, preserve the external host safely, keep the API/private object store off the public surface, and provide tested backup/restore and monitoring.

## Success criteria

- A platform operator can provision and manage a cafe without a per-tenant deployment.
- Cafe staff can maintain the storefront and process orders/reservations without technical help.
- A customer can authenticate, order, reserve, and review their own activity on mobile without seeing another cafe's data.
- Expiry/suspension and verified payment/reactivation preserve data and produce deterministic public behavior.
- Tenant, authorization, phone, pricing, and payment boundaries remain safe under direct API calls and concurrency.

