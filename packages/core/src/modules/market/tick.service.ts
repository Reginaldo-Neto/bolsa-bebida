import { newId } from '@bolsa/db';
import type { ProductState, TickOutput } from '@bolsa/pricing-engine';
import { runTick } from '@bolsa/pricing-engine';
import { eventAllowsPriceTicks } from '@bolsa/shared';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { EventsService } from '../events/events.service';

export interface TickResult {
  eventId: string;
  tick: number;
  prices: Record<string, number>;
  skipped?: 'not-open' | 'fixed-prices' | 'no-products';
}

/**
 * One turn of the market (spec 5 and 8.3). The engine itself is pure; this is
 * the part that reads the world, hands it over, and writes the answer back.
 */
@Injectable()
export class TickService {
  private readonly logger = new Logger(TickService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async runFor(eventId: string, now: Date = new Date()): Promise<TickResult> {
    const event = await this.events.findById(eventId);
    const tick = event.currentTick + 1;

    if (!eventAllowsPriceTicks(event.status)) {
      return { eventId, tick: event.currentTick, prices: {}, skipped: 'not-open' };
    }
    // Spec 4.1: the emergency switch stops the engine; prices stay where the
    // admin put them.
    if (event.fixedPrices) {
      return { eventId, tick: event.currentTick, prices: {}, skipped: 'fixed-prices' };
    }

    const products = await this.prisma.client.product.findMany({
      where: { eventId, archived: false },
      include: { engineState: true },
      orderBy: { sortOrder: 'asc' },
    });

    if (products.length === 0) {
      return { eventId, tick: event.currentTick, prices: {}, skipped: 'no-products' };
    }

    const paidUnits = await this.paidUnitsSince(eventId, event.lastTickAt, now);
    const output = runTick({
      tick,
      params: event.engineParams,
      products: products.map((product) => toEngineState(product)),
      paidUnits,
    });

    await this.persist(eventId, tick, output, paidUnits, now);

    return {
      eventId,
      tick,
      prices: Object.fromEntries(
        output.products.map((product) => [product.productId, product.currentPrice]),
      ),
    };
  }

  /**
   * Spec 5.1: only confirmed sales move prices. The window runs from the last
   * tick to now, keyed on when the payment was confirmed rather than when the
   * order was created, because a slow MB WAY confirmation belongs to the tick
   * that received it.
   */
  private async paidUnitsSince(
    eventId: string,
    since: Date | null,
    now: Date,
  ): Promise<Record<string, number>> {
    const items = await this.prisma.client.orderItem.findMany({
      where: {
        product: { eventId },
        order: {
          payments: {
            some: {
              status: 'PAID',
              receivedAt: { ...(since ? { gt: since } : {}), lte: now },
            },
          },
        },
      },
      select: { productId: true, qty: true },
    });

    const units: Record<string, number> = {};
    for (const item of items) {
      units[item.productId] = (units[item.productId] ?? 0) + item.qty;
    }
    return units;
  }

  private async persist(
    eventId: string,
    tick: number,
    output: TickOutput,
    paidUnits: Record<string, number>,
    now: Date,
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      for (const product of output.products) {
        await tx.productEngineState.update({
          where: { productId: product.productId },
          data: {
            currentPriceCents: product.currentPrice,
            rawPrice: product.rawPrice ?? product.currentPrice,
            smoothedDemand: product.smoothedDemand,
            // The engine drops an override once it expires; mirror that here.
            overridePriceCents: product.manualOverride?.price ?? null,
            overrideUntilTick: product.manualOverride?.untilTick ?? null,
          },
        });
      }

      await tx.priceTick.createMany({
        data: output.products.map((product) => ({
          id: newId(),
          eventId,
          tick,
          productId: product.productId,
          priceCents: product.currentPrice,
          paidUnits: paidUnits[product.productId] ?? 0,
          explain: output.explain[product.productId] ?? {},
          createdAt: now,
        })),
      });

      // Conditional on the tick number: if two workers ever race past the
      // Redis lock, the second one finds currentTick already advanced and the
      // unique index on (event_id, tick, product_id) rejects its rows anyway.
      const advanced = await tx.event.updateMany({
        where: { id: eventId, currentTick: tick - 1 },
        data: { currentTick: tick, lastTickAt: now },
      });

      if (advanced.count === 0) {
        throw new Error(`tick ${tick} for event ${eventId} was already recorded`);
      }
    });

    this.logger.log({ eventId, tick, products: output.products.length }, 'tick applied');
  }
}

function toEngineState(product: {
  id: string;
  groupId: string;
  basePriceCents: number;
  minPriceCents: number;
  maxPriceCents: number;
  stockInitial: number;
  stockAvailable: number;
  engineState: {
    currentPriceCents: number;
    rawPrice: number;
    smoothedDemand: number;
    expectedShare: number | null;
    overridePriceCents: number | null;
    overrideUntilTick: number | null;
  } | null;
}): ProductState {
  const state = product.engineState;

  return {
    productId: product.id,
    groupId: product.groupId,
    basePrice: product.basePriceCents,
    minPrice: product.minPriceCents,
    maxPrice: product.maxPriceCents,
    currentPrice: state?.currentPriceCents ?? product.basePriceCents,
    rawPrice: state?.rawPrice ?? product.basePriceCents,
    smoothedDemand: state?.smoothedDemand ?? 0,
    ...(state?.expectedShare != null ? { expectedShare: state.expectedShare } : {}),
    stockInitial: product.stockInitial,
    stockAvailable: product.stockAvailable,
    // Spec 4.2: a sold-out product leaves the calculation.
    active: product.stockAvailable > 0,
    ...(state?.overridePriceCents != null && state.overrideUntilTick != null
      ? {
          manualOverride: {
            price: state.overridePriceCents,
            untilTick: state.overrideUntilTick,
          },
        }
      : {}),
  };
}
