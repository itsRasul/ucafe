import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { MediaStorageService } from "./media-storage.service";

const storageConfig = Object.fromEntries(["S3_BUCKET", "S3_ENDPOINT", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"].map((key) => [key, process.env[key]]));
const configured = Object.values(storageConfig).every((value) => typeof value === "string" && value.length > 0);

test("private S3 object put, get, and delete round-trip", { skip: !configured && "S3 storage environment is required" }, async () => {
  const storage = new MediaStorageService(new ConfigService(storageConfig as Record<string, string>));
  const key = `support-ticket-test/${randomUUID()}`;
  const expected = Buffer.from("%PDF-1.7\nprivate ticket attachment\n");
  await storage.putObject(key, expected, "application/pdf");
  try {
    const object = await storage.getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.from(chunk));
    assert.equal(object.contentLength, expected.length);
    assert.deepEqual(Buffer.concat(chunks), expected);
  } finally { await storage.removeObject(key); }
});
