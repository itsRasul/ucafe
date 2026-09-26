# Lead and deal lifecycles

These are proposed CRM states. No status API or CRM state machine exists in the current implementation.

## Lead status

| Status | Meaning |
|---|---|
| NEW | Captured and not yet worked. |
| ATTEMPTING_CONTACT | At least one outreach attempt is planned or underway; no meaningful conversation is confirmed yet. |
| CONTACTED | Two-way contact occurred; qualification may still be incomplete. |
| QUALIFIED | The business and contact fit UCafe's current target, and a concrete next sales step is known. |
| NURTURING | The prospect is a fit but has deferred timing; a future follow-up is required. |
| UNQUALIFIED | The prospect is not a fit or explicitly declined. Require an unqualified reason. |
| CONVERTED | The lead was resolved to canonical Organization/Contact records and its initial Deal was created or selected. Require a conversion reference and timestamp. |

Recommended transitions:

~~~mermaid
stateDiagram-v2
    [*] --> NEW
    NEW --> ATTEMPTING_CONTACT
    NEW --> CONTACTED
    NEW --> UNQUALIFIED
    ATTEMPTING_CONTACT --> CONTACTED
    ATTEMPTING_CONTACT --> NURTURING
    ATTEMPTING_CONTACT --> UNQUALIFIED
    CONTACTED --> ATTEMPTING_CONTACT
    CONTACTED --> QUALIFIED
    CONTACTED --> NURTURING
    CONTACTED --> UNQUALIFIED
    QUALIFIED --> NURTURING
    QUALIFIED --> CONVERTED
    QUALIFIED --> UNQUALIFIED
    NURTURING --> ATTEMPTING_CONTACT
    NURTURING --> CONTACTED
    NURTURING --> QUALIFIED
    NURTURING --> UNQUALIFIED
~~~

UNQUALIFIED and CONVERTED are terminal in the ordinary flow. Reopening an UNQUALIFIED lead must be an explicit action that records why and appends history. A converted lead is not converted twice; later renewal/reactivation pursuit is a new Lead and Deal. Every transition validates its reason/required fields and writes status plus history in one transaction. Status keys are code-defined at launch; configuration is deferred.

## Lead conversion semantics

A conversion is an explicit, idempotent operation. It preserves the Lead and its source. In one transaction:

1. Resolve the Organization using exact duplicate candidates or require an operator's explicit choice.
2. Resolve or create its Contact; never match identity solely by phone/email.
3. Create or select one initial Deal and link it to the Lead.
4. Set CONVERTED, converted_at, the conversion reference, and append status history.

A retry with the same Lead returns the existing conversion result. A conflict must be resolved by an authorized user; the API must not silently merge records. Lead conversion does not provision a Tenant, start a Trial, create a Subscription, choose a paid plan, or create an invoice/payment.

## Deal outcome

Deal stage and Deal outcome are separate fields.

- OPEN means the opportunity is still being worked. Its stage is one of the open pipeline stages in [PIPELINE.md](PIPELINE.md).
- WON means an operator has recorded that the café accepted UCafe's commercial offer. It does not assert that a Tenant is provisioned, a Trial is active, or any Payment settled.
- LOST means the opportunity ended without a sale and requires a loss reason.
- Won/Lost close the Deal with one timestamp. Closed Deals are terminal; a new pursuit creates a new Deal. Corrections require an explicitly audited operation.

CRM must never infer WON from tenant provisioning or subscription/payment rows, or infer LOST from a suspended/canceled Tenant/Subscription.

## Keep external lifecycles separate

| Lifecycle | Owner | States/facts | CRM use |
|---|---|---|---|
| Lead | CRM | NEW, ATTEMPTING_CONTACT, CONTACTED, QUALIFIED, NURTURING, UNQUALIFIED, CONVERTED | Sales follow-up record. |
| Deal | CRM | Open stage plus OPEN/WON/LOST outcome | Opportunity progress and explicit sales result. |
| Tenant | Tenants | DRAFT, PREVIEW, ACTIVE, SUSPENDED, ARCHIVED plus soft deletion | Read current operational account state. |
| Trial/Subscription | Subscriptions | TRIALING, ACTIVE, GRACE, SUSPENDED, CANCELED; trial and paid-through timestamps | Read entitlements and dates; never mirror as CRM status. |
| Payment intent | Payments | PENDING, VERIFYING, PAID, FAILED, EXPIRED, CANCELED | Read invoice/payment context only. |

Trial is not a Lead status or Deal outcome. Deal stage TRIAL_ACTIVE means the sales team believes a UCafe trial is underway; the Subscription module remains authoritative for whether one exists and its dates.

