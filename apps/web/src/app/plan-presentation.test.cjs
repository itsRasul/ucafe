const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPlanComparisonRows, planCardFeatureRows } = require("./plan-presentation.js");

const functional = (count) => Array.from({ length: count }, (_, index) => ({ key: `f${index + 1}`, label: `کارکرد ${index + 1}`, order: index + 1, included: true }));
const display = (count) => Array.from({ length: count }, (_, index) => ({ key: `d${index + 1}`, label: `نمایش ${index + 1}`, value: "دارد", sortOrder: index + 1 }));

test("plan cards take all functional features first and fill at most seven rows", () => {
  const rows = planCardFeatureRows(functional(2), display(10));
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.slice(0, 2).map((row) => row.kind), ["functional", "functional"]);
  assert.deepEqual(rows.slice(2).map((row) => row.key), ["display:d1", "display:d2", "display:d3", "display:d4", "display:d5"]);
});

test("six functional features leave one display slot", () => {
  const rows = planCardFeatureRows(functional(6), display(10));
  assert.equal(rows.length, 7);
  assert.equal(rows[6].key, "display:d1");
});

test("more than seven functional features are ordered and exclude display rows", () => {
  const features = functional(9).reverse();
  const rows = planCardFeatureRows(features, display(2));
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((row) => row.key), Array.from({ length: 7 }, (_, index) => `functional:f${index + 1}`));
});

test("comparison rows include the full functional catalog and deduplicate shared display definitions", () => {
  const plans = [
    { key: "bronze", features: [{ key: "menu", value: true }, { key: "crm", value: false }], displayFeatures: [{ key: "support", label: "پشتیبانی", value: "عادی", sortOrder: 8 }] },
    { key: "golden", features: [{ key: "menu", value: true }, { key: "crm", value: true }], displayFeatures: [{ key: "support", label: "پشتیبانی", value: "۲۴ ساعته", sortOrder: 8 }, { key: "domain", label: "دامنه اختصاصی", value: "دارد", sortOrder: 9 }] },
  ];
  const rows = buildPlanComparisonRows([{ key: "menu", label: "منو", order: 1 }, { key: "crm", label: "CRM", order: 2 }, { key: "inventory", label: "انبارداری", order: 3 }], plans);
  assert.equal(rows.length, 5);
  assert.equal(rows[2].featureKey, "inventory");
  assert.deepEqual(rows.slice(3).map((row) => row.featureKey), ["support", "domain"]);
  assert.equal(rows[3].values.bronze, "عادی");
  assert.equal(rows[3].values.golden, "۲۴ ساعته");
});
