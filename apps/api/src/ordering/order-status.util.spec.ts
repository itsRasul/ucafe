import assert from "node:assert/strict";
import test from "node:test";
import { OrderDeliveryMethod, OrderStatus } from "./entities";
import { nextOrderStatuses } from "./order-status.util";

test("pickup orders skip courier-only status", () => {
  assert.deepEqual(nextOrderStatuses(OrderStatus.Ready, OrderDeliveryMethod.Pickup), [OrderStatus.Delivered]);
});

test("courier orders move through delivery status", () => {
  assert.deepEqual(nextOrderStatuses(OrderStatus.Ready, OrderDeliveryMethod.Courier), [OrderStatus.OutForDelivery]);
  assert.deepEqual(nextOrderStatuses(OrderStatus.OutForDelivery, OrderDeliveryMethod.Courier), [OrderStatus.Delivered]);
});

test("delivered orders are terminal", () => {
  assert.deepEqual(nextOrderStatuses(OrderStatus.Delivered, OrderDeliveryMethod.Pickup), []);
});
