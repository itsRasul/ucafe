# Tenant client panel

## Mode

Operate. Returning customers need to understand their current account activity and reach the next task with minimal scanning.

## Surface family

`/panel`, `/panel/profile`, `/panel/reservations`, `/panel/reservations/[id]`, `/panel/orders`, and `/panel/orders/[id]` form one protected client-panel surface.

## Product job

Give an authenticated customer a trustworthy overview of their own orders, reservations, and identity inside the current tenant. History and detail reads remain useful even when the tenant cannot currently accept new orders or reservations.

## Inherited visual truth

Extend the existing tenant public site: Vazir typography, tenant-provided colors and radius, café name/logo, warm editorial surfaces, and Persian-first RTL composition. Do not introduce a second identity, new imagery, icon package, font, or gradient language.

## Information hierarchy

1. Current account and café context.
2. Active orders and upcoming reservations.
3. Latest order and next reservation.
4. Complete paginated histories and immutable details.
5. Profile editing and progressive phone verification.

## Composition

The overview uses an asymmetric desktop composition: a generous introduction and four compact measures followed by a seven/five split for the latest order and next reservation. Detail pages are denser, single-purpose documents. Desktop navigation lives in a sidebar; mobile navigation is a fixed four-item bottom bar.

## States

Every remote surface has stable loading skeletons, a useful empty state, an inline error with retry, and an authenticated result. Status meaning is always written in text and never communicated by color alone.

## Interaction and motion

Use one restrained GSAP entrance sequence on the overview only. Content is visible by default, the sequence uses opacity and small translation, and reduced-motion users receive no animation. All other feedback uses native navigation, form states, and short CSS transitions.

## Responsive and accessibility contract

The panel must work without horizontal overflow at 390×844, tablet widths, and 1440×900. Semantic headings and lists, visible focus, descriptive SVG labels, 44-pixel targets, keyboard access, safe-area padding, Persian labels, Jalali dates, and reduced-motion behavior are required.

## Explicit exclusions

No password UI, avatar system, customer cancellation, reorder, notifications, online payment states, invented fees, invented order statuses, staff reservation notes, cinematic pinning, scroll scrubbing, marquees, testimonials, or raster assets.
