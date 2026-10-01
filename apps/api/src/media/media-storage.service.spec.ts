import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { ConfigService } from "@nestjs/config";
import { MediaStorageService } from "./media-storage.service";

const storageConfig = Object.fromEntries(["S3_BUCKET", "S3_ENDPOINT", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"].map((key) => [key, process.env[key]]));
const configured = Object.values(storageConfig).every((value) => typeof value === "string" && value.length > 0);

test("private S3 object put, get, and delete round-trip", { skip: !configured && "S3 storage environment is required" }, async () => {
  const storage = new MediaStorageService(new ConfigService(storageConfig as Record<string, string>));
  const tenantId = randomUUID();
  const key = `tenants/${tenantId}/support-tickets/test/${randomUUID()}`;
  const expected = Buffer.from("%PDF-1.7\nprivate ticket attachment\n");
  await storage.putObject(key, expected, "application/pdf");
  try {
    const object = await storage.getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.from(chunk));
    assert.equal(object.contentLength, expected.length);
    assert.deepEqual(Buffer.concat(chunks), expected);
    const page = await storage.listSupportTicketObjects(tenantId);
    assert.ok(page.objects.some((item) => item.key === key));
    assert.equal(await storage.removeSupportTicketObjects(tenantId, [key]), 0);
  } finally { await storage.removeObject(key); }
});

test("Ticket object listing/deletion stays inside the tenant prefix", async () => {
  const storage = new MediaStorageService(new ConfigService({ S3_BUCKET: "private", S3_ENDPOINT: "http://localhost", S3_REGION: "test", S3_ACCESS_KEY: "test", S3_SECRET_KEY: "test" }));
  const commands: unknown[] = [];
  (storage as unknown as { client: { send: (command: unknown) => Promise<unknown> } }).client = {
    send: async (command) => { commands.push(command); return {}; },
  };
  const tenantId = "10000000-0000-4000-8000-000000000001";
  const key = `tenants/${tenantId}/support-tickets/ticket/message/file`;

  await storage.listSupportTicketObjects(tenantId, "cursor");
  assert.ok(commands[0] instanceof ListObjectsV2Command);
  assert.equal((commands[0] as ListObjectsV2Command).input.Prefix, `tenants/${tenantId}/support-tickets/`);
  assert.equal((commands[0] as ListObjectsV2Command).input.MaxKeys, 100);
  assert.equal((commands[0] as ListObjectsV2Command).input.ContinuationToken, "cursor");

  await assert.rejects(storage.removeSupportTicketObjects(tenantId, ["tenants/other/support-tickets/file"]), /outside its tenant namespace/);
  assert.equal(commands.length, 1);
  await storage.removeSupportTicketObjects(tenantId, [key]);
  assert.ok(commands[1] instanceof DeleteObjectsCommand);
  assert.deepEqual((commands[1] as DeleteObjectsCommand).input.Delete?.Objects, [{ Key: key }]);
});
