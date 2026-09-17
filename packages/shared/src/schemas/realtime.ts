import { z } from 'zod';
import { EVENT_STATUSES } from '../domain/states';
import { positiveCentsSchema, quantitySchema, stockStatusSchema, uuidSchema } from './primitives';

/**
 * Spec 10.2: server-to-client WebSocket events. The room decides who may see a
 * payload, so nothing here carries data the room is not entitled to.
 */

export const ROOM_PREFIXES = {
  event: 'event',
  participant: 'participant',
  staff: 'staff',
  admin: 'admin',
} as const;

export function eventRoom(eventId: string): string {
  return `${ROOM_PREFIXES.event}:${eventId}`;
}
export function participantRoom(participantId: string): string {
  return `${ROOM_PREFIXES.participant}:${participantId}`;
}
export function staffRoom(eventId: string): string {
  return `${ROOM_PREFIXES.staff}:${eventId}`;
}
export function adminRoom(eventId: string): string {
  return `${ROOM_PREFIXES.admin}:${eventId}`;
}

export const marketTickSchema = z.object({
  eventId: uuidSchema,
  tick: z.number().int(),
  timestamp: z.string(),
  products: z.array(
    z.object({
      id: uuidSchema,
      priceCents: positiveCentsSchema,
      changeVsBasePct: z.number(),
      stockStatus: stockStatusSchema,
    }),
  ),
});
export type MarketTick = z.infer<typeof marketTickSchema>;

export const marketStateSchema = z.object({
  eventId: uuidSchema,
  status: z.enum(EVENT_STATUSES),
  fixedPrices: z.boolean(),
});
export type MarketState = z.infer<typeof marketStateSchema>;

export const productSoldOutSchema = z.object({
  eventId: uuidSchema,
  productId: uuidSchema,
});
export type ProductSoldOut = z.infer<typeof productSoldOutSchema>;

export const orderUpdatedSchema = z.object({
  participantId: uuidSchema,
  orderId: uuidSchema,
  status: z.string(),
});
export type OrderUpdated = z.infer<typeof orderUpdatedSchema>;

export const voucherUpdatedSchema = z.object({
  participantId: uuidSchema,
  voucherId: uuidSchema,
  status: z.string(),
  items: z.array(
    z.object({
      orderItemId: uuidSchema,
      productId: uuidSchema,
      qty: quantitySchema,
      redeemedQty: z.number().int().min(0),
    }),
  ),
});
export type VoucherUpdated = z.infer<typeof voucherUpdatedSchema>;

export const leaderboardUpdatedSchema = z.object({
  eventId: uuidSchema,
  entries: z.array(
    z.object({
      position: z.number().int().min(1),
      nickname: z.string(),
      points: z.number().int(),
      teamCode: z.string().nullable(),
    }),
  ),
});
export type LeaderboardUpdated = z.infer<typeof leaderboardUpdatedSchema>;

export const adminMetricsSchema = z.object({
  eventId: uuidSchema,
  revenueCents: z.number().int().min(0),
  unitsSold: z.number().int().min(0),
  pendingOrders: z.number().int().min(0),
  lowStockProducts: z.number().int().min(0),
  lastTickAt: z.string().nullable(),
});
export type AdminMetrics = z.infer<typeof adminMetricsSchema>;

/** Every payload the server can push, keyed by its event name. */
export interface ServerEvents {
  'market.tick': MarketTick;
  'market.state': MarketState;
  'product.soldout': ProductSoldOut;
  'order.updated': OrderUpdated;
  'voucher.updated': VoucherUpdated;
  'leaderboard.updated': LeaderboardUpdated;
  'admin.metrics': AdminMetrics;
}

export type ServerEventName = keyof ServerEvents;

export const SERVER_EVENT_NAMES = [
  'market.tick',
  'market.state',
  'product.soldout',
  'order.updated',
  'voucher.updated',
  'leaderboard.updated',
  'admin.metrics',
] as const;

/** Redis channel the worker publishes to and the API relays from (spec 8). */
export const REALTIME_CHANNEL = 'bolsa:realtime';

export const realtimeMessageSchema = z.object({
  room: z.string().min(1),
  event: z.enum(SERVER_EVENT_NAMES),
  payload: z.unknown(),
});
export type RealtimeMessage = z.infer<typeof realtimeMessageSchema>;
