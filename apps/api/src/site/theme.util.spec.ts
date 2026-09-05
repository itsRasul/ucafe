import "reflect-metadata";
import { validate } from "class-validator";
import { UpdateSiteDto } from "./dto/update-site.dto";
import assert from "node:assert/strict";
import test from "node:test";
import { safeForeground } from "./theme.util";

test("chooses light foreground for espresso colors", () => assert.equal(safeForeground("#251A15"), "#FFFDF8"));
test("chooses dark foreground for oat colors", () => assert.equal(safeForeground("#F4EEE4"), "#1F1713"));
test("rejects malformed tenant colors", () => assert.throws(() => safeForeground("red")));


test("site identity fields reject blank or null names and preserve optional updates", async () => {
  for (const name of [null, "   ", "x".repeat(161)]) {
    assert.ok((await validate(Object.assign(new UpdateSiteDto(), { name }))).length);
  }
  assert.equal((await validate(Object.assign(new UpdateSiteDto(), { name: "Cafe", branchName: "Main" }))).length, 0);
  assert.equal((await validate(new UpdateSiteDto())).length, 0);
});
