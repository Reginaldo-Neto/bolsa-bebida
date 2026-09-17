import {
  changeRatio,
  LOW_STOCK_DISPLAY_THRESHOLD,
  type MarketProduct,
  type MarketSnapshot,
  type StockStatus,
} from '@bolsa/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { EventsService } from '../events/events.service';

export interface PricePoint {
  tick: number;
  priceCents: number;
  at: string;
}

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /**
   * Spec 4.3 and L2: every product travels with its published min and max, so
   * the app can never show a price without the range it lives in.
   */
  async snapshot(eventId: string): Promise<MarketSnapshot> {
    const event = await this.events.findById(eventId);
    const products = await this.prisma.client.product.findMany({
      where: { eventId, archived: false },
      include: { engineState: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return {
      eventId: event.id,
      eventName: event.name,
      status: event.status,
      fixedPrices: event.fixedPrices,
      tick: event.currentTick,
      serverTime: new Date().toISOString(),
      products: products.map((product): MarketProduct => {
        const priceCents = product.engineState?.currentPriceCents ?? product.basePriceCents;
        return {
          id: product.id,
          name: product.name,
          category: product.category,
          groupId: product.groupId,
          isAlcoholic: product.isAlcoholic,
          volumeMl: product.volumeMl,
          imageUrl: product.imageUrl,
          priceCents,
          basePriceCents: product.basePriceCents,
          minPriceCents: product.minPriceCents,
          maxPriceCents: product.maxPriceCents,
          changeVsBasePct: changeRatio(priceCents, product.basePriceCents),
          stockStatus: stockStatusOf(product.stockAvailable, product.stockInitial),
          sortOrder: product.sortOrder,
        };
      }),
    };
  }

  /** Spec 4.3: the sparkline on each product card. */
  async history(productId: string, from?: Date): Promise<PricePoint[]> {
    const ticks = await this.prisma.client.priceTick.findMany({
      where: {
        productId,
        ...(from ? { createdAt: { gte: from } } : {}),
      },
      orderBy: { tick: 'asc' },
      select: { tick: true, priceCents: true, createdAt: true },
      take: 500,
    });

    return ticks.map((tick) => ({
      tick: tick.tick,
      priceCents: tick.priceCents,
      at: tick.createdAt.toISOString(),
    }));
  }
}

export function stockStatusOf(available: number, initial: number): StockStatus {
  if (available <= 0) {
    return 'SOLD_OUT';
  }
  if (initial > 0 && available / initial < LOW_STOCK_DISPLAY_THRESHOLD) {
    return 'LOW';
  }
  return 'IN_STOCK';
}
