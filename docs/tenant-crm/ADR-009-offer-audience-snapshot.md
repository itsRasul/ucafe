# ADR-009: Snapshot Offer audiences and reuse Discounts

- Status: Accepted
- Date: 2026-09-29

## Context

Tenant CRM needs to target existing commercial discounts to saved CRM Segments. The Discounts domain already calculates prices, enforces coupons and Promotion conditions, and records redemptions. Segment membership is dynamic, so evaluating it continuously at checkout would make a published audience change without a manager action.

## Decision

Store a tenant Offer that links one existing Promotion to one saved active CRM Segment. Keep the Offer in Draft until activation. Activation locks the Offer and Segment, evaluates the saved criteria with the existing Segment compiler, and atomically snapshots the matching Clients and the Segment name/criteria. PromotionPricingService treats active membership and tenant_crm entitlement as added eligibility conditions. Discounts remains the sole authority for prices, schedules, date windows, customer conditions, coupon limits, and redemption rows.

End keeps the historical link and audience but prevents that Offer from granting the discount. It does not modify or reactivate the Promotion. Reopening requires a new Draft and a deliberate activation.

## Consequences

Published audiences remain stable after later Segment or Client attribute changes. Customer 360 reports promotion_redemptions separately from positive discount values in immutable Order snapshots because ordinary automatic discounts may not create redemption rows. Timeline entries are relational projections, not durable domain events.

Activation is one set-based transaction for atomicity. A measured audience-size limit that exceeds safe transaction handling would require a durable staged activation workflow. SMS, campaigns, and automation remain deferred.
