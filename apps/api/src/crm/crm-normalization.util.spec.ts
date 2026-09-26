import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContactEmail, normalizeContactPhone, normalizeCrmComparable, normalizeCrmWebsite, normalizeInstagramHandle, escapeLike } from "./crm-normalization.util";

test("normalizes business identity fields into stable exact-match keys", () => {
  assert.equal(normalizeCrmComparable("  کافه   نُوا "), normalizeCrmComparable("کافه نُوا"));
  assert.deepEqual(normalizeCrmWebsite(" WWW.Example.com/?source=crm#top "), { website: "https://www.example.com", host: "www.example.com" });
  assert.equal(normalizeInstagramHandle("@Cafe.Nova"), "cafe.nova");
  assert.equal(normalizeInstagramHandle("https://www.instagram.com/Cafe.Nova/"), "cafe.nova");
});

test("uses UCafe's mobile normalization and canonical email casing", () => {
  assert.equal(normalizeContactPhone("09121234567"), "+989121234567");
  assert.equal(normalizeContactPhone("00989121234567"), "+989121234567");
  assert.equal(normalizeContactPhone("+989121234567"), "+989121234567");
  assert.equal(normalizeContactEmail("  Owner@Example.COM "), "owner@example.com");
});

test("escapes SQL LIKE wildcards in user-entered search terms", () => {
  assert.equal(escapeLike("100%_!") , "100!%!_!!");
});

