import assert from "node:assert/strict";
import test from "node:test";
import { DataSource } from "typeorm";
import { SupportTicketAutoCloseScheduler, SUPPORT_TICKET_AUTO_CLOSE_INTERVAL_MS } from "./support-ticket-auto-close.scheduler";
import { SupportTicketsService, SUPPORT_TICKET_AUTO_CLOSE_BATCH_SIZE, SUPPORT_TICKET_INACTIVITY_MS, SUPPORT_TICKET_ORPHAN_GRACE_MS } from "./support-tickets.service";

const result = { candidates: 2, closed: 1, skipped: 1, failed: 0 };

test("support ticket auto-close scheduler runs at the configured cadence and invokes the lifecycle sweep", async () => {
  let closeCalls = 0;
  let cleanupCalls = 0;
  const scheduler = new SupportTicketAutoCloseScheduler({
    autoCloseInactiveTickets: async () => { closeCalls += 1; return result; },
    cleanupOrphanTicketAttachments: async () => { cleanupCalls += 1; return { tenantsChecked: 0, scanned: 0, stale: 0, deleted: 0, failed: 0 }; },
  } as unknown as SupportTicketsService);

  assert.equal(SUPPORT_TICKET_AUTO_CLOSE_INTERVAL_MS, 10 * 60 * 1_000);
  await scheduler.runSweep();
  assert.equal(closeCalls, 1);
  assert.equal(cleanupCalls, 1);
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
    cleanupOrphanTicketAttachments: async () => ({ tenantsChecked: 0, scanned: 0, stale: 0, deleted: 0, failed: 0 }),
  } as unknown as SupportTicketsService);

  const first = scheduler.runSweep();
  await scheduler.runSweep();
  assert.equal(calls, 1);
  release();
  await assert.doesNotReject(first);
});

test("orphan sweep skips tracked and recent objects, then deletes only stale untracked keys", async () => {
  const tenantId = "10000000-0000-4000-8000-000000000001";
  const trackedKey = `tenants/${tenantId}/support-tickets/ticket/message/tracked`;
  const recentKey = `tenants/${tenantId}/support-tickets/ticket/message/recent`;
  const orphanKey = `tenants/${tenantId}/support-tickets/ticket/message/orphan`;
  const now = new Date("2026-09-29T12:00:00.000Z");
  const pages: Array<{ objects: Array<{ key: string; lastModified: Date }>; continuationToken?: string }> = [
    { objects: [
      { key: trackedKey, lastModified: new Date(now.getTime() - SUPPORT_TICKET_ORPHAN_GRACE_MS - 1) },
      { key: recentKey, lastModified: new Date(now.getTime() - 60 * 60 * 1_000) },
    ], continuationToken: "next-page" },
    { objects: [{ key: orphanKey, lastModified: new Date(now.getTime() - SUPPORT_TICKET_ORPHAN_GRACE_MS - 1) }] },
  ];
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const deleted: string[][] = [];
  const db = {
    query: async (sql: string, values: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes("FROM coffee_shops")) return [{ id: tenantId }];
      return [{ storageKey: trackedKey }];
    },
  };
  const storage = {
    listSupportTicketObjects: async (_coffeeShopId: string, token?: string) => {
      assert.equal(token, token ? "next-page" : undefined);
      return pages.shift()!;
    },
    removeSupportTicketObjects: async (_coffeeShopId: string, keys: string[]) => { deleted.push(keys); return 0; },
  };
  const service = new SupportTicketsService(db as unknown as DataSource, {} as never, storage as never, {} as never);

  assert.deepEqual(await service.cleanupOrphanTicketAttachments(now), { tenantsChecked: 1, scanned: 2, stale: 1, deleted: 0, failed: 0 });
  assert.deepEqual(await service.cleanupOrphanTicketAttachments(now), { tenantsChecked: 1, scanned: 1, stale: 1, deleted: 1, failed: 0 });
  assert.deepEqual(deleted, [[orphanKey]]);
  const confirmation = queries.find(({ sql }) => sql.includes("support_ticket_attachments"));
  assert.match(confirmation!.sql, /coffee_shop_id=\$2 AND storage_key=ANY\(\$1::text\[\]\)/);
  assert.deepEqual(confirmation!.values, [[trackedKey], tenantId]);
});
