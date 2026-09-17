/**
 * State machines of spec 4.1 (event) and 6.2 (order).
 * Transitions live here, as pure data, so both the API and the tests can
 * assert on the same source of truth.
 */

export const EVENT_STATUSES = ['DRAFT', 'OPEN', 'PAUSED', 'CLOSED_SALES', 'FINISHED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

const EVENT_TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  DRAFT: ['OPEN'],
  OPEN: ['PAUSED', 'CLOSED_SALES', 'FINISHED'],
  PAUSED: ['OPEN', 'CLOSED_SALES', 'FINISHED'],
  CLOSED_SALES: ['FINISHED'],
  FINISHED: [],
};

export function canTransitionEvent(from: EventStatus, to: EventStatus): boolean {
  return EVENT_TRANSITIONS[from].includes(to);
}

/** Spec 4.1: purchases are allowed while OPEN or PAUSED (prices frozen). */
export function eventAllowsPurchases(status: EventStatus): boolean {
  return status === 'OPEN' || status === 'PAUSED';
}

/** Spec 4.5: vouchers stay redeemable until the event is FINISHED. */
export function eventAllowsRedemptions(status: EventStatus): boolean {
  return status === 'OPEN' || status === 'PAUSED' || status === 'CLOSED_SALES';
}

/** Spec 5: the engine only moves prices while the market is OPEN. */
export function eventAllowsPriceTicks(status: EventStatus): boolean {
  return status === 'OPEN';
}

export const ORDER_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'PARTIALLY_REDEEMED',
  'REDEEMED',
  'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['PAID', 'FAILED', 'EXPIRED'],
  PAID: ['PARTIALLY_REDEEMED', 'REDEEMED', 'REFUNDED'],
  PARTIALLY_REDEEMED: ['REDEEMED', 'REFUNDED'],
  REDEEMED: [],
  FAILED: [],
  EXPIRED: [],
  REFUNDED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Spec 6.2: FAILED and EXPIRED release the reserved stock immediately. */
export function orderReleasesStock(status: OrderStatus): boolean {
  return status === 'FAILED' || status === 'EXPIRED';
}

export function orderIsPaid(status: OrderStatus): boolean {
  return status === 'PAID' || status === 'PARTIALLY_REDEEMED' || status === 'REDEEMED';
}

export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'EXPIRED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return status !== 'PENDING';
}

export const QUOTE_STATUSES = ['ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const VOUCHER_STATUSES = [
  'ACTIVE',
  'PARTIALLY_REDEEMED',
  'REDEEMED',
  'REFUNDED',
  'CANCELLED',
] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

export function voucherIsRedeemable(status: VoucherStatus): boolean {
  return status === 'ACTIVE' || status === 'PARTIALLY_REDEEMED';
}

export const ROLES = ['PARTICIPANT', 'STAFF', 'ADMIN', 'SCREEN'] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES = ['STAFF', 'ADMIN'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STOCK_STATUSES = ['IN_STOCK', 'LOW', 'SOLD_OUT'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];
