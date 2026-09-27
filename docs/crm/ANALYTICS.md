# Platform CRM analytics

**Status:** Phase 10 is implemented as a read-only report workspace at `/platform/crm/analytics`. It reports UCafe's platform sales operations. The separate `/admin/analytics` domain reports a café Tenant's orders, reservations, products, inventory, and promotions. A CRM Deal estimate is not order revenue, a Won Deal is not a payment, and Lead source is not a Tenant acquisition record.

## 1. Domain and source of truth

Reports derive from the existing CRM, Workflow, Tenant-link, and Subscription records. PostgreSQL performs bounded filtering and aggregation; no analytics table, view, materialized view, new index, warehouse, event pipeline, or cache was added. Analytics does not write lifecycle or score state. CRM Deal estimates remain optional integer Toman estimates. Successful payments are read through the Subscription domain and are not represented as Deal revenue.

The supported funnel cohort is non-archived Leads created in the selected local date range. Event metrics use the event timestamp named below. Current-state snapshots (open work, current pipeline, currently active customers/plans, current owners) are explicitly current-state and are not historical snapshots.

## 2. Time and range semantics

The report uses `Asia/Tehran`. Date boundaries are local midnight and are queried as half-open intervals: `timestamp >= start` and `< endExclusive`. Presets are `today`, `yesterday`, `last7Days`, `last30Days` (defaults), `currentMonth`, `previousMonth`, `currentQuarter`, `currentYear`, `previousYear`, and `custom`. Custom `start` and `end` are inclusive ISO calendar dates, must be supplied together with `period=custom`, and may span at most 366 calendar days. Previous-period comparisons use the immediately preceding equal-length range or preceding calendar month, quarter, or year, as appropriate.

For a one-day activity series, buckets are hourly and labels are rendered in Tehran time. Ranges up to 45 days use daily buckets, up to 120 days use seven-day spans anchored at the range start, and longer ranges up to 730 days use calendar months. Supported ranges are capped at 366 days, so the series does not reach the year-bucket case. The UI shows a comparison only when its denominator is nonzero; a positive value after a zero-value prior range is labeled new, never infinity.

## 3. Metric Dictionary

All counts below exclude archived CRM source records unless explicitly described as subscription/payment facts. A percentage with a zero denominator is `null` and displays as unavailable. The SQL filters are parameterized. Owner, source, pipeline, and Plan filters apply only to the dimensions they can meaningfully identify; the API section records the per-report behavior.

### Executive overview

| Metric | Meaning and formula | Attribution and exclusions |
|---|---|---|
| Leads created | Count of non-archived Leads created in the range. Previous comparison uses the same rule in the previous range. | `crm_leads.created_at`; current owner and Lead source filters. |
| Leads qualified | Count of non-archived Leads whose `qualified_at` falls in the range. | `crm_leads.qualified_at`; this is an event count and is not the funnel's created-Lead cohort. |
| Lead-to-qualified rate | Unique Leads in the selected created-Lead cohort with non-null `qualified_at` / Leads in that cohort. | Cohort query checks current qualification evidence on the Lead row; a qualified Lead can have been qualified after the selected range. Owner/source filters apply. |
| Won / Lost Deals | Non-archived Deals whose `won_at` / `lost_at` falls in the range. | `crm_deals.won_at` / `lost_at`; Deal owner, originating Lead source, pipeline, and expected Plan filters apply. |
| Deal win rate | Won Deal events / (Won + Lost Deal events) in the range. | Outcome event cohort; open and archived Deals are excluded. Not a probability forecast. |
| Open Deals | Count of non-archived Deals currently `OPEN`. | Current snapshot, independent of the selected date range. Deal filters apply. |
| Open pipeline estimate | Sum of non-null integer-Toman estimates for currently open Deals. `valuedOpenDeals` is the count of open Deals with an estimate. | Current snapshot. Null estimates contribute zero to the sum but remain unvalued; the sum is not collected revenue or a forecast. |
| Average won sales cycle | Mean `won_at - created_at` in days for Deals won in the range. | One value per non-archived Won Deal event; null until at least one qualifying Deal exists. |
| Activities | Count of non-archived Activities whose `occurred_at` falls in the range. | Activity actor/performer and occurrence time; not row creation time. |
| Completed Tasks | Count of first `crm.task.completed` audit events in the range for non-archived Tasks. | Audit event `created_at`; repeats after reopen are not counted again in this metric. |
| Overdue Tasks and rate | Current open Tasks with due time before query time; rate = overdue / current open Tasks with a due time. | Current snapshot, not bounded by report dates. Canceled, archived, and no-due-time Tasks are excluded from both counts. |
| Task completion rate | Non-canceled due-date cohort in the range with a retained completion audit event / non-canceled Tasks whose current `due_at` is in the range. | Due-date cohort, not completion-event period. A Task completed and later reopened still has completion history. Current due date/status are used; historic due-date edits and fully historical point-in-time denominators are unavailable. |
| Follow-up completion rate | Same due-date-cohort formula restricted to `kind=FOLLOW_UP`. | Same due-date and current-state limitation as Task completion rate. |

### Funnel and source measures

The Funnel counts each non-archived Lead created in the selected range once in each stage it has reached, even if its status later regressed. Its authoritative cohort is `crm_leads.created_at`; source filters use the stable Lead source and owner filters use current Lead owner.

| Stage/measure | Formula and evidence |
|---|---|
| Lead Created | Every Lead in the eligible created cohort. |
| Contacted | Cohort Leads with at least one `crm_lead_status_history.next_status='CONTACTED'`. Activities are not used as a proxy. |
| Qualified | Cohort Leads with non-null `qualified_at`. The timestamp is durable, but the funnel stage count asks whether the Lead has qualified at any time, including after the selected period. |
| Deal | Cohort Leads with at least one current non-archived Deal whose `originating_lead_id` points to that Lead. Deal history is not used to duplicate the Lead. |
| Won | Cohort Leads with a current non-archived originating Deal in `WON` status. This is current outcome state for the Lead cohort, not Won events in the period. |
| Converted to Organization | Shown separately: cohort Leads with non-null `converted_at` / eligible Leads. Conversion to an Organization is not a paid-customer event. |

Each displayed `fromPreviousRate` is the count at a funnel stage divided by the prior displayed stage count. These are descriptive transitions across a created-Lead cohort; asynchronous stage completion means they are not same-period event rates and a downstream count can reflect later activity. Customer lifecycle is not appended to this funnel.

Lead-source rows count Leads created in the range by their stored source; `qualified` and `converted` ask whether each cohort Lead currently has the corresponding durable timestamp. Lead qualification/conversion rates divide by that source's Lead cohort. Deal-created counts use `crm_deals.created_at`; Won/Lost counts use `won_at`/`lost_at`. A Deal uses the source of its explicit originating Lead. Deals without one are `UNKNOWN_DIRECT`. Deal win rate is Won / (Won + Lost) outcome events. No current Organization field is copied into attribution.

Customer conversion by Lead source is intentionally not reported: a CRM Organization may have multiple Leads, and Tenant lifecycle facts do not carry a durable causal link to a particular Lead/Deal. Source attribution stops where the source relationship stops.

### Pipeline and stalled Deals

Open Deal count and estimate by stage are current snapshots. Stage duration and progression rows use `crm_deal_stage_history` visits whose `created_at` is in the selected range. A visit ends at the next stage-history timestamp, or at the Deal's `closed_at` when there is no later visit, or query time for an open current visit. Average duration is per stage visit (repeat visits count separately); negative/zero anomalies are floored at zero. Progression rate divides distinct Deals with a later ordinal stage visit (or a later Won event) by distinct Deals entering that stage in the range. It is an observed progression, not a same-period conversion rate.

A stalled Deal is currently open and has stayed in its latest recorded stage for at least 14 days, with no non-archived Activity tied to the Deal, its Organization, its originating Lead, or a Contact in that Organization during those same 14 days. This is a deterministic attention heuristic, not a prediction. The report total is complete; at most 20 oldest stage entries are listed. Filters apply using current Deal owner/source/pipeline/expected Plan.

### Activity, productivity, and owners

Activity counts by type/outcome and the series use non-archived Activity `occurred_at`; the series is zero-filled at its selected granularity. The UI shows Activity volume and outcome/type, completed/overdue Tasks, open follow-ups, and their rates. Completed Task event totals use the first retained completion audit event timestamp, not current `completed_at`, so reopen cycles do not inflate first-completion volume.

Owner rows deliberately combine dimensions with their own meanings: Lead owner; Deal owner; Activity performer (`actor_user_id`); Task assignee. Lead counts use the created-Lead cohort; qualified/converted indicate durable current Lead state. Open Deal and open Task figures are current workloads. Won/Lost Deals and Activities are range events. Task counts are currently open Tasks assigned to the owner, regardless of due date. Owner assignment is current, not an historical owner snapshot. Labels are masked; the analytics response does not expose full phone numbers or email addresses.

### Scoring

Leads are grouped by their current stored overall score and configuration state, in the selected created-Lead cohort. The bands are `UNCONFIGURED`, 0–39, 40–69, 70–84, and 85–100. `qualified` means current status `QUALIFIED`; `converted` means current status `CONVERTED`; observed conversion rate = currently converted cohort Leads / Leads in the band. Mean Fit, Engagement, and Overall use the stored score snapshot. Converted Leads retain their last score; other Leads use their current score.

The report does not reconstruct score at qualification/conversion. Score rule changes and recalculations mean current band is not necessarily the historical band at creation. Observed conversion by band is descriptive and is not a likelihood, forecast, or causal effect.

### Automation

Workflow execution cohorts use `crm_workflow_executions.created_at`; the report counts executions by current Workflow name. Success and failure use the execution's `SUCCEEDED` / `FAILED` status. Terminal success rate = succeeded / (succeeded + failed), excluding `RUNNING`, `RETRYING`, and `PENDING`. Stale action recovery reconciles the parent execution to `RETRYING` or terminal `FAILED`, so repeated process crashes do not leave exhausted work counted as currently running. Retried executions count an execution with any action attempt greater than one or manual retry count greater than zero. Automation-created Tasks are distinct Tasks linked through `automation_action_execution_id` and created in the range.

These are descriptive execution outcomes. They do not show that an automation caused qualification, a Deal, or customer conversion. Archived/renamed Workflow definitions and execution history may affect current labels; history remains the source of execution facts.

### Customer lifecycle

The report considers non-archived CRM Organizations with a current Tenant link. `linkedOrganizations` counts those CRM Organizations even if the Tenant has no Subscription row; lifecycle metrics require a Subscription row. It includes current active-trial and active-paid-customer snapshots, trial starts and trial conversion measures, and the current Plan distribution of active paid customers. This section requires both `crm.read` and `subscriptions.read`.

| Measure | Definition |
|---|---|
| Active trial | Linked Tenant Subscription whose effective status, evaluated with the shared Subscription lifecycle rules at query time, is Trialing. |
| Active paid customer | Linked Tenant Subscription whose effective status is Active and has a recorded successful non-legacy payment operation (`PURCHASE`, `TRIAL_TO_PAID`, `RENEWAL`, `REACTIVATION`, or `UPGRADE`). |
| Current Plan distribution | Effective current Plan for the same active-paid set, including an already-effective pending Plan. This is a current snapshot, independent of report period. |
| Trials started | Subscription `trial_started_at` within the selected range. |
| Completed trial cohort | Trial-start cohort with a successful `TRIAL_TO_PAID` payment recorded at any time or whose `trial_ends_at` is in the past at query time. |
| Trial-to-paid rate | Trial-start cohort rows with a recorded successful `TRIAL_TO_PAID` payment / completed trial cohort. Payment may occur after the selected start range; this is an eventual-to-date cohort measure, not an event rate. |
| Mean time to paid | Mean `TRIAL_TO_PAID.paid_at - trial_started_at` in days for successful conversions whose `paid_at` is in the selected range. |

An expected Plan filter applies to CRM Deal reports. The customer section has a distinct subscription/current-Plan filter. There is no source-based customer conversion report because the link from one of multiple Leads/Deals to Tenant subscription events is not authoritative. No subscription or payment state is changed by an analytics request.

## 4. Historical and data limitations

- Tags, custom-field values, dynamic Segment membership, and Workflow criteria are current state; retained history does not provide point-in-time segmentation.
- Lead source is stable, but owner and Deal ownership are read from their current row fields. Historical owner snapshots are not available.
- Task completion audit events preserve completion occurrence, but due-date edits are not historized. Task due-date completion rates use the current due date and current cancellation/archive state.
- Scoring uses current configuration/current score for active Leads and last retained score for converted Leads; score-at-conversion is not retained as a dedicated fact.
- Deal stage history supports visits, but the report summarizes time in recorded stages and does not model probability-weighted forecasts or causal stage attribution.
- Customer/payment events have no durable link to a specific source Lead when an Organization has multiple Leads. Paid customer counts require explicit successful payment facts and exclude legacy paid-through rows.
- Data volume in the local CRM is insufficient to establish production cardinality or stable query-plan performance. Revisit plans and add an index only when measured production query plans/latency justify it.

## 5. Database and performance

No Phase 10 migration or Analytics table/view/index was introduced. Reports use parameterized PostgreSQL count/sum/average/group queries and database-side `EXISTS`, window functions, and bounded result sets; they do not load complete CRM entities into Node.js. Existing indexes on Lead status/source/owner, Deal owner/stage/history, Activity related records/time, Task assignee/status/due time, Workflow history, and audit event time support the source reads. Query plans must be rechecked at representative production volume before adding indexes, caching, or a materialized read model. There is no Redis cache or export path.

## 6. API and filters

Routes are under `/api/v1/platform/crm/analytics`: `GET overview`, `funnel`, `pipeline`, `sources`, `work`, `owners`, `scoring`, `automation`, and `customers`. All require `crm.read`; `customers` also requires `subscriptions.read`.

Query parameters: `period` (defaults to `last30Days`), paired `start`/`end` for `period=custom`, `ownerId` (UUID or `UNASSIGNED`), a catalog `source`, fixed `pipelineKey=ucafe-default`, `expectedPlanId` (UUID), and `subscriptionPlanId` (UUID). Unknown fields are rejected by the global DTO validation pipe. Date range validation and limits are shared with Tenant Analytics, but CRM analytics is a separate API/domain.

Filter applicability: source and owner scope Lead-cohort reports; Deal owner/source/pipeline/expected Plan scope Deal reports; work uses Activity actor and Task assignee and ignores Lead-source/Plan filters; automation uses only date range; customer lifecycle uses the linked CRM Organizations and optional subscription Plan; there is no historical Tag, custom-field, Segment, or customer source filter. Open work, open pipeline snapshots, current owners, and current subscription status remain current-state metrics even when a date range is selected.

## 7. UI

`/platform/crm/analytics` is a Persian RTL, responsive report page with Overview, Funnel, Pipeline, Sources, Activity & Tasks, Sales Owners, Scoring, Automation, and permission-gated Customer Lifecycle sections. Date, owner, Lead source, and expected Deal Plan filters are stored in the URL. Native CSS bars/tables and the shared platform CSS are used; no chart package is added. Reports load independently and expose retry status so a failed section does not blank successful sections. Data is fetched live; the page supports refresh and shows Overview generation time. No export, chart drill-down, or metric snapshot is implemented.

## 8. Security and visibility

The controller uses the platform access-token and permission guards. CRM analytics returns operational aggregates and masked owner labels, not raw CRM contact PII, payment amounts/provider details, Tenant member/contact data, or arbitrary query access. Customer lifecycle output is separately protected by `subscriptions.read`. Permission checks are server-side; navigation visibility is not authorization.

## 9. Tests and related documents

The API has controller permission-metadata coverage, PostgreSQL integration coverage for each report, and date-range unit coverage including `currentQuarter`. There are no dedicated frontend component/E2E tests or lint command. Typecheck/build and actual run outcomes are recorded in the Phase 10 entry in [PROGRESS.md](../PROGRESS.md); unauthenticated route access does not count as authenticated visual QA.

See [DATA_MODEL.md](DATA_MODEL.md), [API.md](API.md), [UX.md](UX.md), [PERMISSIONS.md](PERMISSIONS.md), [TESTING.md](TESTING.md), [PHASES.md](PHASES.md), and [ADR-009](ADR-009-crm-analytics-read-model.md). Tenant analytics remains documented separately in [../ANALYTICS.md](../ANALYTICS.md).
