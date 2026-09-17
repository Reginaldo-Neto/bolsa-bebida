import { z } from 'zod';
import {
  DEFAULT_ALCOHOL_UNITS_PER_WINDOW,
  DEFAULT_ALCOHOL_WINDOW_MINUTES,
  DEFAULT_MAX_QTY_PER_PRODUCT,
  PAYMENT_TIMEOUT_SECONDS,
  QUOTE_TTL_SECONDS,
} from '../constants';
import {
  centsSchema,
  nicknameSchema,
  nifSchema,
  phoneSchema,
  positiveCentsSchema,
  quantitySchema,
  shortCodeSchema,
  teamCodeSchema,
  uuidSchema,
} from './primitives';

/** Purchase limits stored on the event (spec 4.4 and L8). */
export const eventLimitsSchema = z.object({
  maxQtyPerProduct: z.number().int().min(1).max(50).default(DEFAULT_MAX_QTY_PER_PRODUCT),
  alcoholUnitsPerWindow: z.number().int().min(1).max(50).default(DEFAULT_ALCOHOL_UNITS_PER_WINDOW),
  alcoholWindowMinutes: z.number().int().min(1).max(600).default(DEFAULT_ALCOHOL_WINDOW_MINUTES),
  // L1: the quote is what locks the price, so its lifetime is a legal setting.
  quoteTtlSeconds: z.number().int().min(15).max(300).default(QUOTE_TTL_SECONDS),
  paymentTimeoutSeconds: z.number().int().min(30).max(900).default(PAYMENT_TIMEOUT_SECONDS),
});

export type EventLimitsInput = z.input<typeof eventLimitsSchema>;

export function parseEventLimits(input: unknown) {
  return eventLimitsSchema.parse(input ?? {});
}

/** POST /events/{id}/join */
export const joinRequestSchema = z.object({
  nickname: nicknameSchema,
  // L5: no alcohol without an explicit 18+ declaration.
  isAdult: z.literal(true, {
    errorMap: () => ({ message: 'e necessario declarar que tem 18 anos ou mais' }),
  }),
  // L7: appearing in the ranking is a separate, opt-in consent.
  leaderboardOptIn: z.boolean().default(false),
  teamCode: teamCodeSchema.optional(),
});

export type JoinRequest = z.infer<typeof joinRequestSchema>;

export const cartItemSchema = z.object({
  productId: uuidSchema,
  qty: quantitySchema,
});

/** POST /quotes */
export const quoteRequestSchema = z.object({
  items: z.array(cartItemSchema).min(1, 'o carrinho esta vazio').max(20),
});

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

/** POST /orders */
export const orderRequestSchema = z.object({
  quoteId: uuidSchema,
  phone: phoneSchema,
  nif: nifSchema.optional(),
});

export type OrderRequest = z.infer<typeof orderRequestSchema>;

/** POST /me/recover */
export const recoverRequestSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().length(6),
});

/** POST /staff/vouchers/scan */
export const voucherScanRequestSchema = z.union([
  z.object({ qr: z.string().trim().min(10) }),
  z.object({ shortCode: shortCodeSchema }),
]);

export const redeemItemSchema = z.object({
  orderItemId: uuidSchema,
  qty: quantitySchema,
});

/** POST /staff/vouchers/{id}/redeem */
export const redeemRequestSchema = z.object({
  items: z.array(redeemItemSchema).min(1),
  // L5: staff confirms the identification check for alcoholic items.
  ageChecked: z.boolean().default(false),
});

export const stockStatusSchema = z.enum(['IN_STOCK', 'LOW', 'SOLD_OUT']);

/** A product as the market screen sees it (spec 4.3). */
export const marketProductSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  category: z.string().nullable(),
  groupId: uuidSchema,
  isAlcoholic: z.boolean(),
  volumeMl: z.number().int().nullable(),
  imageUrl: z.string().nullable(),
  priceCents: positiveCentsSchema,
  basePriceCents: positiveCentsSchema,
  // L2: the published range travels with every price.
  minPriceCents: positiveCentsSchema,
  maxPriceCents: positiveCentsSchema,
  changeVsBasePct: z.number(),
  stockStatus: stockStatusSchema,
  sortOrder: z.number().int(),
});

export type MarketProduct = z.infer<typeof marketProductSchema>;

export const marketSnapshotSchema = z.object({
  eventId: uuidSchema,
  eventName: z.string(),
  status: z.enum(['DRAFT', 'OPEN', 'PAUSED', 'CLOSED_SALES', 'FINISHED']),
  fixedPrices: z.boolean(),
  tick: z.number().int(),
  serverTime: z.string(),
  products: z.array(marketProductSchema),
});

export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;

export const quoteItemSchema = z.object({
  productId: uuidSchema,
  name: z.string(),
  qty: quantitySchema,
  unitPriceCents: positiveCentsSchema,
  basePriceCents: positiveCentsSchema,
  lineTotalCents: centsSchema,
});

export type QuoteItem = z.infer<typeof quoteItemSchema>;

export const quoteResponseSchema = z.object({
  id: uuidSchema,
  items: z.array(quoteItemSchema),
  totalCents: centsSchema,
  expiresAt: z.string(),
  // L1: the countdown the participant sees, so the locked price is visible.
  ttlSeconds: z.number().int(),
});

export type QuoteResponse = z.infer<typeof quoteResponseSchema>;
