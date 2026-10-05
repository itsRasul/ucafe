import assert from "node:assert/strict";
import test from "node:test";
import { groupPlanDisplayFeatures } from "./plan-display-feature.util";

test("display values group by plan and sort by configured order with a stable key tie-break", () => {
  const grouped = groupPlanDisplayFeatures([
    { planId: "silver-id", planKey: "silver", featureId: "b", key: "b", label: "پشتیبانی", value: "ویژه", sortOrder: 10 },
    { planId: "silver-id", planKey: "silver", featureId: "a", key: "a", label: "پنل", value: "دارد", sortOrder: 10 },
    { planId: "golden-id", planKey: "golden", featureId: "c", key: "c", label: "دامنه", value: "دارد", sortOrder: 20 },
  ]);
  assert.deepEqual(grouped.get("silver-id")?.map((feature) => feature.key), ["a", "b"]);
  assert.deepEqual(grouped.get("golden-id")?.map((feature) => feature.value), ["دارد"]);
  assert.equal(grouped.has("bronze-id"), false);
});
