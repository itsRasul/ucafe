# Lead and deal lifecycles

Lead state transitions and conversion are implemented in Phase 2. Deal lifecycle behavior is implemented in Phase 3.

## Lead status

| Status | Meaning |
|---|---|
| NEW | Captured and not yet worked. |
| ATTEMPTING_CONTACT | At least one outreach attempt is planned or underway; no meaningful conversation is confirmed yet. |
| CONTACTED | Two-way contact occurred; qualification may still be incomplete. |
| QUALIFIED | The business and contact fit UCafe's current target, and a concrete next sales step is known. |
| NURTURING | The prospect is a fit but has deferred timing; a future follow-up is required. |
| UNQUALIFIED | The prospect is not a fit or explicitly declined. Require an unqualified reason. |
| CONVERTED | The lead was resolved to one canonical Organization and Contact. Require both links and a conversion timestamp. A Deal is not part of Phase 2 conversion. |

Allowed transitions (qualification and unqualification use dedicated operations):

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
    CONTACTED --> NURTURING
    CONTACTED --> UNQUALIFIED
    QUALIFIED --> NURTURING
    QUALIFIED --> UNQUALIFIED
    NURTURING --> ATTEMPTING_CONTACT
    NURTURING --> CONTACTED
    NURTURING --> UNQUALIFIED
    QUALIFIED --> CONVERTED
~~~

Qualification is allowed only from CONTACTED or NURTURING and retains optional qualification notes and the first `qualified_at`. Unqualification is allowed from NEW, ATTEMPTING_CONTACT, CONTACTED, QUALIFIED, and NURTURING; require one reason from `NOT_INTERESTED`, `NOT_RELEVANT`, `NO_BUDGET`, `NO_RESPONSE`, `DUPLICATE`, `INVALID_CONTACT`, `ALREADY_USING_COMPETITOR`, `TOO_EARLY`, or `OTHER`. Optional detail is stored only for `OTHER`. Status plus append-only history commit in one transaction. Ordinary transitions are NEW → ATTEMPTING_CONTACT / CONTACTED; ATTEMPTING_CONTACT → CONTACTED / NURTURING; CONTACTED → ATTEMPTING_CONTACT / NURTURING; QUALIFIED → NURTURING; NURTURING → ATTEMPTING_CONTACT / CONTACTED. The dedicated qualify operation transitions CONTACTED or NURTURING → QUALIFIED; dedicated unqualify transitions eligible states → UNQUALIFIED. UNQUALIFIED and CONVERTED are terminal; reopening is not supported. Archived Leads cannot be edited until restored. Status and source keys are code-defined, not configurable.

## Lead conversion semantics

A conversion is an explicit, idempotent operation available only from QUALIFIED. It preserves the Lead and its source. In one transaction:

1. Resolve the Organization using exact duplicate candidates or require an operator's explicit choice.
2. Resolve an existing Contact belonging to the selected Organization or create one from the Lead's contact name and contact details. A Contact is required; if the Lead has no contact name, link an existing Contact or add the name before converting. Never match identity solely by phone/email.
3. Set CONVERTED, converted_at, and both links; append status history.

A retry with the same Lead returns the existing conversion result. A conflict must be resolved by an authorized user; the API must not silently merge records. Duplicate Organization and Contact candidates block conversion until the operator explicitly links a candidate or confirms a distinct record. Phase 2 creates no Deal or Pipeline. Conversion does not provision a Tenant, start a Trial, create a Subscription, choose a paid plan, or create an invoice/payment.

An operator may explicitly create a Deal from a converted Lead. The unique originating-Lead reference makes that association one-to-one; creating a Deal never changes the Lead lifecycle. Leads without conversion may not originate a Deal.

Lead scoring is orthogonal to this lifecycle. Status, qualification, and conversion do not impose a score floor or change Priority. Conversion evaluates and stores the final Lead score immediately before setting CONVERTED; subsequent rule/source changes exclude it, preserving that historical score. Archive likewise preserves the last score, while restore triggers recalculation.

## Deal outcome

Deal stage and Deal outcome are separate fields.

- OPEN means the opportunity is still being worked. Its stage is one of the open pipeline stages in [PIPELINE.md](PIPELINE.md).
- WON means an operator has recorded that the café accepted UCafe's commercial offer. It does not assert that a Tenant is provisioned, a Trial is active, or any Payment settled.
- LOST means the opportunity ended without a sale and requires a loss reason.
- Won/Lost close the Deal with one timestamp. Closed Deals are terminal and no reopen/correction API is provided; a new pursuit creates a new Deal.

CRM must never infer WON from tenant provisioning or subscription/payment rows, or infer LOST from a suspended/canceled Tenant/Subscription.

## Keep external lifecycles separate

| Lifecycle | Owner | States/facts | CRM use |
|---|---|---|---|
| Lead | CRM | NEW, ATTEMPTING_CONTACT, CONTACTED, QUALIFIED, NURTURING, UNQUALIFIED, CONVERTED | Sales follow-up record; conversion links Organization and Contact in Phase 2. |
| Deal | CRM | Open stage plus OPEN/WON/LOST outcome | Opportunity progress and explicit sales result. |
| Tenant | Tenants | DRAFT, PREVIEW, ACTIVE, SUSPENDED, ARCHIVED plus soft deletion | Read current operational account state. |
| Trial/Subscription | Subscriptions | TRIALING, ACTIVE, GRACE, SUSPENDED, CANCELED; trial and paid-through timestamps | Read entitlements and dates; never mirror as CRM status. |
| Payment intent | Payments | PENDING, VERIFYING, PAID, FAILED, EXPIRED, CANCELED | Read invoice/payment context only. |

Trial is not a Lead status or Deal outcome. Deal stage TRIAL_ACTIVE means the sales team believes a UCafe trial is underway; the Subscription module remains authoritative for whether one exists and its dates.

## Organization 360 and Timeline

Organization 360 and the Timeline are read views over these lifecycle sources, not new CRM lifecycle state. Lead creation/status timestamps come from the Lead and append-only status history; Deal creation/stage/outcome timestamps come from the Deal and append-only stage history. A Deal outcome is terminal. Task complete/cancel/reopen occurrence times are read from their corresponding transactional audit actions because the Task row clears terminal metadata on reopen. Activities and Notes use their own source rows. Tenant creation, explicit Tenant link/unlink, Trial start, and successful paid Subscription operations are included only where their durable timestamps exist. Current Tenant status is not a status-transition history; Subscription status is a non-mutating time-derived projection. No expiry, grace, suspension, cancellation, or scheduled Plan-change transition is inferred. A Note edit changes its current text but does not create a historical update event. See [TIMELINE.md](TIMELINE.md).
