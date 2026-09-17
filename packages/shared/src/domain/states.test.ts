import { describe, expect, it } from 'vitest';
import {
  EVENT_STATUSES,
  ORDER_STATUSES,
  canTransitionEvent,
  canTransitionOrder,
  eventAllowsPriceTicks,
  eventAllowsPurchases,
  eventAllowsRedemptions,
  orderIsPaid,
  orderReleasesStock,
  voucherIsRedeemable,
} from './states';

describe('event state machine', () => {
  it('follows the spec 4.1 lifecycle', () => {
    expect(canTransitionEvent('DRAFT', 'OPEN')).toBe(true);
    expect(canTransitionEvent('OPEN', 'PAUSED')).toBe(true);
    expect(canTransitionEvent('PAUSED', 'OPEN')).toBe(true);
    expect(canTransitionEvent('PAUSED', 'CLOSED_SALES')).toBe(true);
    expect(canTransitionEvent('CLOSED_SALES', 'FINISHED')).toBe(true);
  });

  it('never goes backwards from FINISHED or reopens closed sales', () => {
    for (const to of EVENT_STATUSES) {
      expect(canTransitionEvent('FINISHED', to)).toBe(false);
    }
    expect(canTransitionEvent('CLOSED_SALES', 'OPEN')).toBe(false);
    expect(canTransitionEvent('OPEN', 'DRAFT')).toBe(false);
  });

  it('allows purchases while OPEN or PAUSED only', () => {
    expect(eventAllowsPurchases('OPEN')).toBe(true);
    expect(eventAllowsPurchases('PAUSED')).toBe(true);
    expect(eventAllowsPurchases('CLOSED_SALES')).toBe(false);
    expect(eventAllowsPurchases('DRAFT')).toBe(false);
    expect(eventAllowsPurchases('FINISHED')).toBe(false);
  });

  it('allows redemptions until the event is FINISHED', () => {
    expect(eventAllowsRedemptions('CLOSED_SALES')).toBe(true);
    expect(eventAllowsRedemptions('FINISHED')).toBe(false);
  });

  it('only ticks prices while OPEN', () => {
    expect(eventAllowsPriceTicks('OPEN')).toBe(true);
    expect(eventAllowsPriceTicks('PAUSED')).toBe(false);
  });
});

describe('order state machine', () => {
  it('follows the spec 6.2 diagram', () => {
    expect(canTransitionOrder('PENDING', 'PAID')).toBe(true);
    expect(canTransitionOrder('PENDING', 'FAILED')).toBe(true);
    expect(canTransitionOrder('PENDING', 'EXPIRED')).toBe(true);
    expect(canTransitionOrder('PAID', 'PARTIALLY_REDEEMED')).toBe(true);
    expect(canTransitionOrder('PAID', 'REDEEMED')).toBe(true);
    expect(canTransitionOrder('PARTIALLY_REDEEMED', 'REDEEMED')).toBe(true);
    expect(canTransitionOrder('PARTIALLY_REDEEMED', 'REFUNDED')).toBe(true);
  });

  it('never resurrects a terminal order', () => {
    for (const to of ORDER_STATUSES) {
      expect(canTransitionOrder('REDEEMED', to)).toBe(false);
      expect(canTransitionOrder('EXPIRED', to)).toBe(false);
      expect(canTransitionOrder('REFUNDED', to)).toBe(false);
    }
  });

  it('never pays an order that already failed', () => {
    expect(canTransitionOrder('FAILED', 'PAID')).toBe(false);
    expect(canTransitionOrder('EXPIRED', 'PAID')).toBe(false);
  });

  it('releases stock only on FAILED and EXPIRED', () => {
    expect(orderReleasesStock('FAILED')).toBe(true);
    expect(orderReleasesStock('EXPIRED')).toBe(true);
    expect(orderReleasesStock('PAID')).toBe(false);
  });

  it('counts redeemed orders as paid for the pricing engine', () => {
    expect(orderIsPaid('PAID')).toBe(true);
    expect(orderIsPaid('PARTIALLY_REDEEMED')).toBe(true);
    expect(orderIsPaid('REDEEMED')).toBe(true);
    expect(orderIsPaid('PENDING')).toBe(false);
    expect(orderIsPaid('REFUNDED')).toBe(false);
  });
});

describe('voucher status', () => {
  it('is redeemable while active or partially redeemed', () => {
    expect(voucherIsRedeemable('ACTIVE')).toBe(true);
    expect(voucherIsRedeemable('PARTIALLY_REDEEMED')).toBe(true);
    expect(voucherIsRedeemable('REDEEMED')).toBe(false);
    expect(voucherIsRedeemable('REFUNDED')).toBe(false);
    expect(voucherIsRedeemable('CANCELLED')).toBe(false);
  });
});
