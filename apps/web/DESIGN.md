---
name: UCafe Platform Acquisition
description: Warm editorial Persian acquisition and subscription purchase UI.
colors:
  purple-500: "#5a2dcb"
  purple-600: "#46219f"
  orange-500: "#ff7a45"
  cream-50: "#fff8f1"
  white: "#ffffff"
  ink-900: "#1f1b24"
  ink-600: "#625b6b"
  ink-500: "#706879"
  teal-600: "#0f766e"
  lavender-100: "#eee9ff"
  danger-600: "#a52e35"
  warning-700: "#8a4b14"
  neutral-200: "#ded7e3"
typography:
  display:
    fontFamily: "Vazir, Tahoma, sans-serif"
    fontSize: "clamp(2.5rem, 4.5vw, 4.75rem)"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0"
  h1:
    fontFamily: "Vazir, Tahoma, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3.5rem)"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0"
  h2:
    fontFamily: "Vazir, Tahoma, sans-serif"
    fontSize: "clamp(1.75rem, 3vw, 2.75rem)"
    fontWeight: 700
    lineHeight: 1.55
    letterSpacing: "0"
  h3:
    fontFamily: "Vazir, Tahoma, sans-serif"
    fontSize: "clamp(1.25rem, 2vw, 1.5rem)"
    fontWeight: 700
    lineHeight: 1.65
    letterSpacing: "0"
  title:
    fontFamily: "Vazir, Tahoma, sans-serif"
    fontSize: "1.25rem"
  body-large:
    fontFamily: "Vazir, Tahoma, sans-serif"
    fontSize: "1.125rem"
    lineHeight: 1.9
  body:
    fontFamily: "Vazir, Tahoma, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.9
  body-small:
    fontFamily: "Vazir, Tahoma, sans-serif"
    fontSize: ".875rem"
    lineHeight: 1.9
  caption:
    fontFamily: "Vazir, Tahoma, sans-serif"
    fontSize: ".75rem"
    lineHeight: 1.9
  label:
    fontFamily: "Vazir, Tahoma, sans-serif"
    fontSize: ".875rem"
    fontWeight: 500
    lineHeight: 1.9
  button:
    fontFamily: "Vazir, Tahoma, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.9
rounded:
  sm: ".375rem"
  md: ".75rem"
  lg: "1rem"
  xl: "1.5rem"
  full: "999px"
spacing:
  "1": ".25rem"
  "2": ".5rem"
  "3": ".75rem"
  "4": "1rem"
  "5": "1.25rem"
  "6": "1.5rem"
  "8": "2rem"
  "10": "2.5rem"
  "12": "3rem"
  "16": "4rem"
  "20": "5rem"
  "24": "6rem"
components:
  button-primary:
    backgroundColor: "{colors.purple-500}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: ".75rem 1.5rem"
  button-primary-hover:
    backgroundColor: "{colors.purple-600}"
  button-secondary:
    backgroundColor: "{colors.lavender-100}"
    textColor: "{colors.purple-500}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: ".75rem 1.5rem"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink-900}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: ".75rem 1.5rem"
  button-outline-hover:
    backgroundColor: "{colors.lavender-100}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-900}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: ".75rem 1.5rem"
  button-ghost-hover:
    backgroundColor: "{colors.lavender-100}"
  button-destructive:
    backgroundColor: "{colors.danger-600}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: ".75rem 1.5rem"
  button-destructive-hover:
    backgroundColor: "color-mix(in srgb, var(--color-danger) 85%, var(--color-text-primary))"
  button-sm:
    typography: "{typography.body-small}"
    padding: ".5rem 1rem"
  button-lg:
    padding: ".75rem 2rem"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-900}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: ".75rem 1rem"
    width: "100%"
  badge:
    backgroundColor: "{colors.lavender-100}"
    textColor: "{colors.purple-500}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: ".25rem .75rem"
  card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.lg}"
    padding: "2rem"
  alert:
    backgroundColor: "{colors.lavender-100}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.md}"
    padding: "1rem"
  navigation:
    backgroundColor: "{colors.cream-50}"
    textColor: "{colors.ink-900}"
    typography: "{typography.body-small}"
  disclosure:
    textColor: "{colors.ink-900}"
    padding: "1.25rem 0"
---

# Design System: UCafe Platform Acquisition

## Overview

**Creative North Star: "Warm Editorial SaaS"**

Warm Editorial SaaS makes software for café owners feel clear, capable, and approachable. Cream gives the interface warmth; purple gives actions a consistent voice; restrained Tangerine and Fresh Teal make product evidence and status readable. Generous Persian typography, quiet borders, and useful product views carry the identity.

This system applies only to the opt-in `.ucafe-ui` platform landing, `/start`, and `/start/result`. Tenant storefront themes, tenant client panels, and existing owner/platform admin shells retain their own identity. The repository-root `PRODUCT.md` describes tenant-client context; it is not a mandate to replace those themes with this palette. Page composition and conversion strategy belong in the scoped surface brief.

**Key Characteristics:**

- Persian RTL with self-hosted Vazir and explicit LTR islands for phones, hostnames, and OTP.
- Two token layers: reusable brand primitives and scoped semantic roles.
- Flat bordered panels, cream/white/lavender tonal hierarchy, and restrained depth.
- Real product evidence; illustrative UI remains visibly labeled as sample data.

**The Scoped Identity Rule.** Apply acquisition styling through `.ucafe-ui`. Do not map these tokens onto tenant themes or either admin shell without a separate adoption decision.

Built sources: [tokens](src/app/ui/tokens.css), [shared primitives](src/app/ui/primitives.tsx), [landing styles](src/app/platform-landing.css), and [purchase styles](src/app/start/purchase.css). [The surface brief](.impeccable/surfaces/apps-web-src-app-platform-landing-tsx.md) retains the local direction and required states. This is a record of the implemented foundation, not a promise of a full component library.

## Colors

The palette combines warm paper, strong purple interaction, and restrained product/status accents. Frontmatter values correspond to the `--uc-<name>` brand primitives. Semantic assignments are local to `.ucafe-ui`.

### Primary

- **UCafe Purple** (`purple-500`): primary actions, selected product tabs, focus rings, and deliberate text emphasis.
- **Deep UCafe Purple** (`purple-600`): the primary hover state.
- **Soft Lavender** (`lavender-100`): quiet secondary actions, badges, alerts, and tonal section surfaces.

### Secondary

- **Tangerine** (`orange-500`): a restrained data accent in product charts. It does not replace purple as the main action color.
- **Fresh Teal** (`teal-600`): secondary accent, checkmarks, and success text.

### Tertiary

- **Error Red** (`danger-600`): actionable error text and the supported destructive button variant.
- **Warning Amber** (`warning-700`): the declared warning role; no separate warning component is shipped in this scope.

### Neutral

- **Warm Cream** (`cream-50`): page background.
- **Clean White** (`white`): product, plan, consultation, and purchase surfaces; primary foreground.
- **Espresso Ink** (`ink-900`): primary text and the occasional dark tonal section.
- **Secondary Ink** (`ink-600`): supporting prose and field hints.
- **Muted Ink** (`ink-500`): captions and placeholder text.
- **Quiet Border** (`neutral-200`): panel edges and row dividers.

| Semantic property | Assignment |
| --- | --- |
| `--color-bg-page` | `--uc-cream-50` |
| `--color-bg-surface`, `--color-primary-foreground` | `--uc-white` |
| `--color-bg-subtle` | `--uc-lavender-100` |
| `--color-text-primary` | `--uc-ink-900` |
| `--color-text-secondary` | `--uc-ink-600` |
| `--color-text-muted` | `--uc-ink-500` |
| `--color-primary`, `--color-ring` | `--uc-purple-500` |
| `--color-primary-hover` | `--uc-purple-600` |
| `--color-accent` | `--uc-orange-500` |
| `--color-secondary-accent`, `--color-success` | `--uc-teal-600` |
| `--color-border` | `--uc-neutral-200` |
| `--color-warning` | `--uc-warning-700` |
| `--color-danger` | `--uc-danger-600` |
| `--color-danger-hover` | Mix `--color-danger` at 85% with `--color-text-primary` |

**The Semantic First Rule.** Components consume semantic color roles. Brand primitives remain the source behind those roles; page-local hex colors are not a parallel palette.

Status remains readable in text as well as color. The sidecar's synthesized tonal ramps are preview metadata, not additional shipped CSS colors.

## Typography

**Display, Body, and Label Font:** Vazir, with Tahoma and sans-serif fallbacks. Existing self-hosted light, regular, medium, and bold files use `font-display: swap`; this foundation introduces no font dependency.

Persian reading rhythm governs the hierarchy: spacious body leading, balanced headings, and zero heading tracking. Use `text-align: start` and logical spacing. Keep phones, hostnames, and OTP in explicit LTR islands; use Persian-friendly numbers and integer Toman formatting elsewhere.

| Role | Implemented use |
| --- | --- |
| Display | Landing hero; responsive overrides are local to the landing. |
| h1 | Acquisition page titles and larger section statements. |
| h2 | Section headings; supporting prose uses body-large. |
| h3 | Smaller headings; also the purchase card heading size. |
| Title | Brand text, short row headings, selected metrics, and OTP digits; weight follows context. |
| Body-large | Hero and section introduction text. |
| Body | Default reading and field text. |
| Body-small | Navigation, feature rows, field hints, and supporting form prose. |
| Caption | Product labels, provenance/sample notes, badges, and fine print. |
| Label | Visible form labels. |
| Button | Medium and large action labels; small buttons retain the button weight with body-small size. |

The heading scale and line heights live in frontmatter. Local mobile hero clamps remain in landing CSS; they are not a second global type scale. Existing copy constraints include the hero introduction at a maximum width of 33rem and section introductions at 44rem.

## Layout

Use a centered fluid container with a maximum width of 78rem. Its outer gutters are 24px per side above 40rem and 16px per side at or below 40rem. The spacing scale is based on 4px increments; use its named steps instead of page-specific numbers.

The landing uses generous editorial columns, open divided lists, and flat product panels. Default section spacing is 96px, falling to 64px on small screens. Plan grids use auto-fit columns with an 18rem minimum bounded by available width. This spatial grammar supports different content arrangements; it does not require a fixed section order on future surfaces.

| At or below | Shipped response |
| --- | --- |
| 64rem | Reduce column gaps; the process becomes two columns; the hero uses the h1 size. |
| 48rem | Collapse major two-column content and purchase layout; replace desktop links with the mobile menu; reduce purchase card padding to 24px. |
| 40rem | Stack primary hero actions and compact forms; change feature comparison from a table to per-plan native disclosures; reduce purchase card padding to 20px and OTP gap to 4px. |

The purchase form uses six equal OTP columns with `minmax(0, 1fr)` and `min-width: 0`. Default OTP gaps are 8px. The final 360px check measured each OTP field at 44.328125px after the small-screen padding/gap correction; preserve this target rather than squeezing the fields further. Use at least 44px interactive targets and prevent page overflow at 360, 390, 768, 1440, and 1920px.

## Elevation & Depth

Depth comes primarily from cream, white, lavender, a dark tonal band, and 1px borders. Ordinary plan, purchase, and product panels have no shadow. The existing floating storefront crop uses the floating shadow. Small, medium, and floating shadow definitions are retained in the sidecar; the first two are available foundation tokens rather than evidence of extra raised components.

**The Quiet Depth Rule.** Ordinary forms, plan cards, and product panels use tonal surfaces and borders. The floating storefront crop is the shipped exception; a shadow token's existence does not make every card elevated.

Motion is limited to short background and press-state feedback: fast and normal durations plus the existing ease-out token. The current button transition uses the fast duration and browser-default easing; it does not consume the declared ease-out token. The scoped reduced-motion rule disables animations and transitions and restores automatic scrolling.

## Shapes

Controls use gently rounded medium corners; product, plan, consultation, and purchase panels use large corners. Small corners serve badges and chart bars. Full rounding is reserved for small status dots. The extra-large radius is declared for future opt-in reuse and is not a reason to round every section.

Bordered panels remain rectangles; sections themselves have no decorative border, radius, or shadow. The palette and measured spacing supply warmth without decorative blobs or glass effects.

## Components

### Buttons

`Button` and `ButtonLink` share one style function. Their five supported variants are `primary`, `secondary`, `outline`, `ghost`, and `destructive`; their sizes are `sm`, `md`, and `lg`. The default is primary/medium.

| Variant | Default and hover |
| --- | --- |
| Primary | Purple with white text; deep purple hover. |
| Secondary | Lavender with purple text; hover mixes primary at 16% with the surface. |
| Outline | Transparent with Espresso Ink text and a quiet border; lavender hover. |
| Ghost | Transparent with Espresso Ink text and a transparent border; lavender hover. |
| Destructive | Error Red with white text; hover deepens the red by mixing danger at 85% with primary text. This supported variant has no acquisition caller. |

Small, medium, and large minimum heights are 44px, 48px, and 56px. Frontmatter records their padding. All variants press down by 1px, use the scoped focus treatment, and use native disabled behavior with 55% opacity. Loading remains explicit caller-provided text and `disabled`; there is no implicit spinner or loading prop.

### Fields and feedback

Native input, textarea, and select share a white surface, quiet 1px border, medium corners, inherited body type, and a minimum height of 52px. Placeholder text uses muted ink. Checkboxes remain native with purple accent and a 20px visual box within their labeled target.

Keep visible labels and associate relevant errors/hints through `aria-describedby`. Existing purchase fields use appropriate phone/numeric keyboards and OTP completion. Error alerts use Error Red text over a surface mixed with 8% Error Red; generic alerts use lavender. Busy and result messages retain `role="status"` or `role="alert"` where implemented.

### Badges and cards

Badges are quiet lavender labels with purple caption text and small corners; they are not interactive chips. Plan cards have 32px padding, dropping to 24px on small screens. Purchase cards have 40px padding, then 24px and 20px at the documented breakpoints. Product panels separate their header and content with borders. Reuse these CSS patterns; no generic Card, Badge, or Input React wrapper exists.

### Navigation and disclosures

The landing header is sticky, cream, and divided by a quiet border. Desktop links have 44px minimum height. At 48rem the native button-controlled mobile menu exposes `aria-expanded`/`aria-controls`, closes after selection, and returns focus to its trigger on Escape.

FAQ and small-screen plan comparison use native `details`/`summary`, divided rows, bold text, and visible chevrons that rotate with `open`. Removing the browser marker must preserve the custom disclosure cue. Comparison keeps explicit “دارد / ندارد” text.

### Product tour and section headings

The five-view product tour uses a tablist, linked tab/tabpanel IDs, roving tab stops, RTL-aware left/right keys, and Home/End navigation. Selected tabs use purple/white; unselected tabs use secondary text and a lavender hover. Product previews label sample data, retain textual equivalents for chart values, and expose only supported product behavior.

`SectionHeader` is the other shared React primitive: a heading ID, title, and optional supporting description. Native fields, disclosures, status panels, and CSS containers cover the remaining shipped needs.

Every interactive component inherits a 3px purple `:focus-visible` outline with a 4px offset. Preserve readable feedback without relying on motion.

## Do's and Don'ts

### Do:

- **Do** keep `.ucafe-ui` adoption explicit and preserve tenant and admin identity.
- **Do** use semantic colors and the existing spacing, type, and radius scales.
- **Do** use the confirmed current UCafe logo and optimized real product captures; label illustrative data.
- **Do** preserve Persian RTL, visible focus, associated field errors, textual status, and explicit LTR technical values.
- **Do** retain native disclosure behavior and the six-column OTP layout with the shipped small-screen padding and gaps.
- **Do** show loading, empty, unavailable, retry, disabled, and authoritative result states in the same visual system.

### Don't:

- **Don't** fabricate testimonials, customers, metrics, prices, or product capabilities to fill a layout.
- **Don't** replace product evidence with generic coffee imagery, decorative blobs, large gradients, or excessive glass and shadows.
- **Don't** add a new component or dependency merely to mirror a native field, checkbox, or disclosure.
- **Don't** shrink mobile comparison into a wide unreadable table or make a required interaction depend on animation.
