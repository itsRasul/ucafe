import { OrderDeliveryMethod, OrderStatus } from "./entities";

export function nextOrderStatuses(status: OrderStatus, deliveryMethod: OrderDeliveryMethod) {
  const courier = deliveryMethod === OrderDeliveryMethod.Courier;
  const transitions: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.UnderReview]: [OrderStatus.Preparing],
    [OrderStatus.Preparing]: [OrderStatus.Ready],
    [OrderStatus.Ready]: courier ? [OrderStatus.OutForDelivery] : [OrderStatus.Delivered],
    [OrderStatus.OutForDelivery]: [OrderStatus.Delivered],
    [OrderStatus.Delivered]: [],
  };
  return transitions[status];
}
