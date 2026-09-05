# Cafexa product specification

## Product definition

Cafexa (کافکسا) is a multi-tenant SaaS that gives Iranian coffee shops a premium Persian-first website without deploying a separate frontend per tenant. A placeholder platform domain is `cafexa.com`; local development uses `cafexa.localhost`. The first launch must remain a focused MVP.

The product promise is a fast, modern, soft, visually memorable website that helps a cafe look more professional than competitors while customers can immediately view the menu, find the cafe, and reserve a table.

## Users and roles

- **Visitor:** reads public cafe content, menu, address, hours, and availability.
- **Customer:** authenticates using an Iranian mobile number and OTP, submits reservations, and views their own reservations. Passwords are not required.
- **Cafe owner/staff:** manages site content, menu, reservations, and permitted tenant settings. The current seeded tenant role set includes owner permissions; a complete admin UI is still planned.
- **Platform administrator/owner:** provisions tenants and manages lifecycle, subscriptions, users, scoped roles and permission assignments through a separate platform control center.

## Confirmed commercial model

- Currency is toman and future payments use Iranian gateways.
- Silver is the launch plan at a configurable default of 1,900,000 toman per prepaid calendar month.
- Golden has a configurable default of 2,900,000 toman but is inactive/postponed until its features exist. The architecture must remain ready for it.
- No setup fee. The subscription is paid before the coming month of service, not afterward.
- A controlled seven-day trial is started explicitly by the platform.
- Trial expiry without payment suspends the site. A paid subscription enters a seven-day grace period after its prepaid end; if still unpaid it is suspended.
- Payment/reactivation restores the site and preserves tenant data.
- Suspended public sites show a designed Persian unavailable state, never a technical error.

## MVP functional requirements

### Multi-tenancy and onboarding

- One shared codebase and database with strict coffee-shop scoping.
- Platform subdomain per tenant; custom domains are postponed.
- Platform admin provisions a coffee shop, primary branch, domain, owner invitation/membership, website settings, reservation settings, and subscription lifecycle.
- First launch assumes one primary branch in public experiences.

### Public website

- Persian-first RTL, responsive, mobile-first and server-rendered where practical.
- One curated premium template with controlled brand colors and radius preset; no unrestricted CSS/page builder.
- Hero, announcement, story, menu, contact/address, opening hours and links.
- Theme colors must maintain readable foreground contrast.
- Graceful missing/average content and imagery; media upload/cropping is planned, not implemented.

### Menu

- Active categories; named/described items; toman price; availability and featured state.
- Optional variants/sizes with prices and one default variant.
- Public menu hides inactive categories and clearly marks unavailable items.
- Search, dietary/allergen filters, add-ons and ordering are future work.

### Reservations

- Availability derives from branch opening hours and configurable settings: enabled state, interval, duration, party bounds, capacity, lead time and advance window.
- Only valid future slots ending before closing are offered.
- Customer selects date, party size and time, supplies name and optional note, authenticates by OTP, and creates a `PENDING` request.
- Owner/staff can list and transition requests through confirmed, rejected, canceled, completed or no-show states using valid transitions.
- Concurrent requests must not overbook capacity.
- No complex physical-table assignment in MVP.

### Authentication, privacy and authorization

- Iranian mobile normalization, six-digit expiring OTP, resend/attempt/rate limits, short-lived access token and rotating opaque refresh session.
- Kavenegar integration is mocked for development; the OTP is logged only in development until a real key/provider is configured.
- Phone data is encrypted at rest where designed and never publicly shared. Reservation APIs do not return customer phone numbers.
- Platform and tenant RBAC are separate; access never falls back across scopes.

### Subscription enforcement

- Public tenant resolution calculates effective lifecycle and blocks suspended sites.
- Feature-disabled modules are hidden publicly; tenant data is retained for reactivation/upgrades.
- Payments currently support manually recording a prepaid period and price snapshot; automatic gateway settlement is planned.

## Non-functional requirements

- Strong tenant isolation, least privilege, validated configuration/input, no secrets in source or responses.
- Fast ordinary mobile performance: minimal client JS, optimized media, stable layouts, progressive enhancement, accessible focus/touch targets, RTL/LTR-ready components, reduced-motion support.
- Target excellent Core Web Vitals; a formal measurable performance budget remains pending.
- PostgreSQL migrations only; transactional writes and race protection for billing/capacity.
- Important states: default, focus, loading, empty, disabled, error, success, offline/network failure, unavailable feature and suspended tenant.
- Prices are configurable data and payments preserve historical snapshots.

## Visual direction

Warm editorial minimalism with modern digital interactions: warm ivory/oat, espresso, beige/latte, restrained caramel/terracotta and optional sage; editorial headings, readable interface typography, generous whitespace, restrained borders/shadows, high-quality coffee/lifestyle photography, and subtle opacity/transform motion. Avoid generic Bootstrap/WordPress restaurant styling, corporate/cold visuals, crowded dashboards, excessive gradients/glassmorphism/parallax/animation, scroll hijacking, autoplay sound, and heavy client rendering.

## Out of scope for first launch

- Customer ordering, carts and order payments.
- Automated recurring billing and production Iranian gateway integration.
- Golden modules, custom domains, multiple templates, full multi-branch UX.
- Advanced analytics, page builder and unrestricted theme controls.
- Advanced table/floor maps, recommendation engines, reviews/Instagram ingestion, dietary/allergen filtering unless separately approved.

## Success criteria

- A platform admin can provision and activate a cafe without a per-tenant deployment.
- An owner can maintain essential website/menu/reservation information without technical help.
- A mobile customer can find menu/location information and request a reservation in a few clear steps.
- Tenant data and phone data do not leak across tenants or public responses.
- Subscription expiry reliably produces the branded unavailable state and payment restores service.
- Public pages remain attractive, understandable and fast on ordinary mobile devices.

## Domain terminology

- **Coffee shop / tenant:** isolated business account.
- **Branch:** physical cafe location; MVP public flows use the primary branch.
- **Domain:** hostname mapped to a tenant.
- **Membership:** a user’s tenant-scoped relationship; roles grant permissions.
- **Plan:** configurable commercial offering. **Subscription:** tenant lifecycle instance. **Prepaid period:** paid future service interval. **Grace:** seven-day overdue window for a previously paid subscription.
- **Preview/trial:** controlled seven-day evaluation. **Suspended:** public site unavailable without deleting data.
- **Reservation settings:** capacity and slot rules for a branch. **Reservation:** authenticated customer request, initially pending.
