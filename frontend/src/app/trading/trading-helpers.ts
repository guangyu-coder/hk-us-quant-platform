import type { Order } from '../../types/index.ts';

type OrdersEnvelope = {
  orders?: unknown;
};

export function normalizeOrdersCollection(orders: unknown): Order[] {
  if (Array.isArray(orders)) {
    return orders as Order[];
  }

  if (orders && typeof orders === 'object') {
    const envelope = orders as OrdersEnvelope;
    if (Array.isArray(envelope.orders)) {
      return envelope.orders as Order[];
    }
  }

  return [];
}

export function selectTradingOrderId(
  orders: Order[],
  selectedOrderId: string | null
): string | null {
  if (orders.length === 0) {
    return null;
  }

  const selectedExists = selectedOrderId
    ? orders.some((order) => order.id === selectedOrderId)
    : false;

  return selectedExists ? selectedOrderId : orders[0].id;
}

export function deriveTradingOrderCounts(orders: Order[]) {
  const open = orders.filter(
    (order) =>
      order.status === 'Pending' ||
      order.status === 'Submitted' ||
      order.status === 'PartiallyFilled'
  ).length;

  const partiallyFilled = orders.filter((order) => order.status === 'PartiallyFilled').length;
  const filled = orders.filter((order) => order.status === 'Filled').length;
  const terminal = orders.filter(
    (order) =>
      order.status === 'Filled' ||
      order.status === 'Cancelled' ||
      order.status === 'Rejected'
  ).length;

  return {
    total: orders.length,
    open,
    partiallyFilled,
    filled,
    terminal,
  };
}
