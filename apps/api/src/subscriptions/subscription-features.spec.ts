import assert from "node:assert/strict";
import test from "node:test";
import { mergePlanFeatures, SubscriptionFeatures } from "./subscription-features";

test("plan module updates preserve existing non-module features", () => {
  assert.deepEqual(mergePlanFeatures({ menu: false }, { reservations: true, onlineOrdering: false }), {
    [SubscriptionFeatures.Menu]: false,
    [SubscriptionFeatures.Reservations]: true,
    [SubscriptionFeatures.OnlineOrdering]: false,
  });
});

test("plan module updates keep existing values when a module is omitted", () => {
  assert.deepEqual(mergePlanFeatures({ menu: true, reservations: true, onlineOrdering: false }, { onlineOrdering: true }), {
    [SubscriptionFeatures.Menu]: true,
    [SubscriptionFeatures.Reservations]: true,
    [SubscriptionFeatures.OnlineOrdering]: true,
  });
});
