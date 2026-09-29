# Tenant CRM Offers

## Purpose and source boundaries

An Offer connects a CRM audience to an existing Promotion so a café can target commercial discounts using its own Client data. It owns targeting and lifecycle only. The Discounts domain continues to own price calculation, coupons, Promotion dates and schedules, customer conditions, limits, and redemption records. No second pricing or redemption engine exists.

An Offer references one tenant Promotion and one saved active Tenant CRM Segment. A tenant Promotion can be linked to at most one Offer. The Offer does not copy discount terms. The Segment may be edited after activation, but the Offer keeps the audience captured at activation.

## Lifecycle

- DRAFT: managers can change the Offer name, description, Promotion, and active saved Segment. It has no effect on checkout.
- ACTIVE: the linked Promotion can apply only to Clients in the frozen audience, while all existing Promotion rules continue to apply.
- ENDED: the link remains for history and reporting but cannot grant the discount. Ending does not deactivate, edit, or make the linked Promotion generally available again. An Ended Offer cannot be reactivated.

Activation validates that the Promotion is currently RUNNING in the café timezone and that its coupon, if present, is active and within its date window. Existing checkout code remains responsible for all other eligibility and use limits. Activation locks the Offer and Segment, compiles the saved Segment with the existing evaluator, and performs one set-based audience insert in the same transaction that saves the Segment snapshot and changes status.

## Persistence and tenant security

Migration TenantCrmOffers1790650000000 creates tenant_crm_offers and tenant_crm_offer_audience_members. Composite tenant foreign keys bind Offer to Promotion, Segment, creator membership, and audience Client. Promotion and Segment deletion is restricted while referenced; deleting a Client removes that Client's audience membership. Each Promotion can have one Offer, and each Offer/Client membership is unique.

The activation snapshot stores Segment name and criteria for explanation. The Audience table stores one row per matching Client. Preview uses the current Segment evaluator and returns a masked sample; it does not reserve or save membership. API reads and writes always scope by coffee_shop_id.

## Discount application and reporting

PromotionPricingService loads Offer status and the customer's membership in the same tenant as the Promotion. DRAFT records do not gate a Promotion. An ACTIVE Offer requires snapshot membership and the tenant_crm subscription feature. ENDED Offers and tenants without the feature cannot use the linked Promotion through this Offer.

Reporting keeps two facts separate:

- Recorded redemptions count applied rows from promotion_redemptions within the Offer lifecycle. Existing coupon and first-order flows own these rows.
- Applied orders count distinct Orders with a positive amount in the Promotion Order snapshot or an Order item snapshot, also within the Offer lifecycle. This detects automatic discount applications that do not create redemption rows.

The measures can overlap and are not added together. Timeline entries project audience assignment and positive saved Order applications from these durable relational records using deterministic cursor keys; no new event store is introduced.

## API and access

The API provides paginated Offer list/detail and audience pages, active Segment preview, Draft create/update, activation, ending, and a paginated Client Offers projection. Reads require tenant_crm.read, menu.read, and the tenant_crm feature. Mutations also require tenant_crm.manage. The Promotions workspace remains the only place to edit discount terms.

The manager UI is Persian-first and RTL. It previews a Segment, explains the activation snapshot, and shows audience and application counts. Customer 360 shows recorded redemptions separately from Order snapshot applications. Phone numbers in preview and audience pages are masked.

## Limits and exclusions

Activation uses one set-based database transaction to keep a published audience atomic. If measured tenant audiences exceed a safe transaction size, a durable staged activation job with an explicit pending state is the upgrade path. Campaigns, SMS, scheduled communications, workflows, loyalty mutations, and feedback automation are not part of this phase.
