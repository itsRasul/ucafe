import { OrderDeliveryMethod, OrderStatus } from "./entities";

export const COMPLETED_ORDER_STATUS = OrderStatus.Delivered;
export const CANCELLED_ORDER_STATUS = OrderStatus.Canceled;

export function nextOrderStatuses(status: OrderStatus, deliveryMethod: OrderDeliveryMethod) {
  const courier = deliveryMethod === OrderDeliveryMethod.Courier;
  const transitions: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.UnderReview]: [OrderStatus.Preparing, OrderStatus.Canceled],
    [OrderStatus.Preparing]: [OrderStatus.Ready, OrderStatus.Canceled],
    [OrderStatus.Ready]: courier ? [OrderStatus.OutForDelivery, OrderStatus.Canceled] : [OrderStatus.Delivered, OrderStatus.Canceled],
    [OrderStatus.OutForDelivery]: [OrderStatus.Delivered],
    [OrderStatus.Delivered]: [],
    [OrderStatus.Canceled]: [],
  };
  return transitions[status];
}
