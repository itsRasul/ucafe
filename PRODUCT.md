# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Persian-speaking café customers use U-Cafe on mobile and desktop to discover a tenant café, authenticate with a one-time password, place an order, reserve a table, and review their own activity.

## Product Purpose

U-Cafe gives each café a tenant-branded public website and a secure customer account experience. Success means customers can complete and revisit operational tasks quickly without learning a separate product language for each café.

## Positioning

One multi-tenant system carries each café's identity, availability, ordering, reservation, and customer ownership rules through a single Persian-first experience.

## Operating Context

Customers usually arrive from a café's public site, authenticate with an Iranian mobile number and OTP, then order for pickup or courier delivery, reserve a table, or inspect their own history. The client panel is an operate-first surface: identity, current activity, and task status take priority over promotional content.

## Capabilities and Constraints

- Authentication is passwordless and OTP-only; password storage, password recovery, and password UI do not exist.
- Customer data is always scoped by both tenant and authenticated client identity.
- The client panel covers overview, profile, reservations, and orders. Saved-address management remains in checkout.
- Order and reservation history remains readable when a tenant plan disables creation of new records.
- Customer cancellation, reorder, notifications, online order payment, avatar management, and new backend statuses are outside the current product scope.
- Persian is the primary interface language, dates are shown in Jalali form where customer-facing, and right-to-left layout is authoritative.

## Brand Commitments

The product name is U-Cafe. Each tenant's existing logo, café name, colors, radius, public-site imagery, and Vazir typography remain authoritative. New authenticated surfaces extend that identity rather than creating a separate visual brand.

## Evidence on Hand

The repository contains the working tenant public site, OTP client session, checkout, immutable order and address snapshots, reservations, Jalali date utilities, same-origin API proxy, and tenant theme variables. No avatar system or separate client-panel imagery exists, and future work must not fabricate one.

## Product Principles

- Preserve tenant identity while keeping operational tasks immediately scannable.
- Keep authentication passwordless and progressively reveal OTP steps only when needed.
- Never trade tenant or client isolation for convenience.
- Show real domain states and historical snapshots instead of invented payment or fulfillment concepts.
- Prefer accessible native web behavior and concise interfaces over decorative complexity.

## Accessibility & Inclusion

The web experience is keyboard accessible, uses visible focus states, pairs status color with text, provides at least 44-pixel touch targets, respects reduced-motion preferences, and remains usable across mobile, tablet, and desktop widths.
