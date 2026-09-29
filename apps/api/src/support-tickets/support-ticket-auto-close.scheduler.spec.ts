import assert from "node:assert/strict";
import test from "node:test";
import { DataSource } from "typeorm";
import { SupportTicketAutoCloseScheduler, SUPPORT_TICKET_AUTO_CLOSE_INTERVAL_MS } from "./support-ticket-auto-close.scheduler";
import { SupportTicketsService, SUPPORT_TICKET_AUTO_CLOSE_BATCH_SIZE, SUPPORT_TICKET_INACTIVITY_MS } from "./support-tickets.service";

const result = { candidates: 2, closed: 1, skipped: 1, failed: 0 };

test("support ticket auto-close scheduler runs at the configured cadence and invokes the lifecycle sweep", async () => {
  let calls = 0;
  const scheduler = new SupportTicketAutoCloseScheduler({ autoCloseInactiveTickets: async () => { calls += 1; return result; } } as unknown as SupportTicketsService);

  assert.equal(SUPPORT_TICKET_AUTO_CLOSE_INTERVAL_MS, 10 * 60 * 1_000);
  await scheduler.runSweep();
  assert.equal(calls, 1);
});

test("lifecycle sweep uses a 48-hour cutoff and a bounded candidate batch", async () => {
  let queryText = "";
  let queryValues: unknown[] = [];
  const service = new SupportTicketsService(
    { query: async (sql: string, values: unknown[]) => { queryText = sql; queryValues = values; return []; } } as unknown as DataSource,
    {} as never,
    {} as never,
    {} as never,
  );
  const now = new Date("2026-09-29T12:34:56.789Z");

  assert.deepEqual(await service.autoCloseInactiveTickets(now), { candidates: 0, closed: 0, skipped: 0, failed: 0 });
  assert.equal((queryValues[0] as Date).getTime(), now.getTime() - SUPPORT_TICKET_INACTIVITY_MS);
  assert.equal(queryValues[1], SUPPORT_TICKET_AUTO_CLOSE_BATCH_SIZE);
  assert.match(queryText, /status='WAITING_FOR_TENANT'.*last_platform_reply_at <= \$1.*last_message_sender_type='PLATFORM_USER'/s);
  assert.match(queryText, /LIMIT \$2/);
});

test("support ticket auto-close scheduler isolates failed sweeps and skips overlapping local runs", async () => {
  let release!: () => void;
  let calls = 0;
  const scheduler = new SupportTicketAutoCloseScheduler({
    autoCloseInactiveTickets: async () => {
      calls += 1;
      await new Promise<void>((resolve) => { release = resolve; });
      throw new Error("database unavailable");
    },
  } as unknown as SupportTicketsService);

  const first = scheduler.runSweep();
  await scheduler.runSweep();
  assert.equal(calls, 1);
  release();
  await assert.doesNotReject(first);
});
