# Activities, tasks, notes, and timeline

## Record the right kind of work

- **Activity = something that happened.** Examples include CALL, MEETING, EMAIL, SMS, WHATSAPP, DEMO, FOLLOW_UP, and OTHER. Store the actor, occurred-at time, interaction type, concise summary, and related Organization plus optional Contact, Lead, Deal, or Task.
- **Task = something that needs to happen.** Store title/type, due-at time, assignee, status (OPEN, COMPLETED, CANCELED), and optional relationship to Contact, Lead, or Deal under its Organization. Completion records completed-at and completed-by. A task is not proof of an interaction.
- **Note = internal context.** Store author/time/body and relate it to an Organization, optionally a Lead or Deal. A note is not an outbound message or Activity.

Activities are historical evidence and are append-only except for an audited correction or privacy redaction. Completed and canceled Tasks remain. Notes may be corrected or redacted only with an authorized action and retained audit metadata. No VoIP, email sync, SMS automation, WhatsApp integration, or bulk messaging is included in this phase plan.

The initial Task flow is OPEN to COMPLETED or CANCELED. Both outcomes are terminal. If further work is needed, create another Task so the original due date and result remain clear.

## Future Organization/Deal timeline

A future Organization 360 timeline can combine records without making the timeline itself the source of truth:

1. CRM-owned Activity and Note records, Task creation/completion, Lead status history, and Deal stage/outcome history.
2. Read-only source facts from Tenant, Subscription, and payment records where those records provide trustworthy timestamps and the operator is authorized to see them.
3. Source labels and deep links that distinguish CRM actions from external domain facts.

Build the first timeline as a bounded, dynamically assembled read projection over those source records. It is not CQRS, event sourcing, or an append-only copy of every Tenant event. Do not use platform_audit_events as the main timeline because it records selected operator actions, not complete histories. Do not invent past lifecycle transitions from current-state columns.

If a future requirement needs complete external lifecycle history or reliable asynchronous consumers, define source-owned events and delivery guarantees then. Keep that concern out of Phase 0.
