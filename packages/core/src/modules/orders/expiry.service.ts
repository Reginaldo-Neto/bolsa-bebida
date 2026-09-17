import type { QuoteItem } from '@bolsa/shared';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { InventoryService, type StockMovement } from '../inventory/inventory.service';
import { OrdersService } from './orders.service';

const BATCH_SIZE = 200;

/**
 * Reservations that nobody completed. Without this, an abandoned checkout would
 * hold its drinks out of the market until the party ended.
 */
@Injectable()
export class ExpiryService {
  private readonly logger = new Logger(ExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersService,
  ) {}

  /** Spec 4.4: an ACTIVE quote past its TTL releases the stock it reserved. */
  async expireQuotes(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.client.quote.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      take: BATCH_SIZE,
    });

    let released = 0;
    for (const quote of expired) {
      const items = quote.items as unknown as QuoteItem[];
      const movements: StockMovement[] = items.map((item) => ({
        productId: item.productId,
        qty: item.qty,
      }));

      try {
        await this.prisma.client.$transaction(async (tx) => {
          // Conditional, so a quote being turned into an order right now is
          // left alone: whoever changes the status first wins.
          const claimed = await tx.quote.updateMany({
            where: { id: quote.id, status: 'ACTIVE' },
            data: { status: 'EXPIRED' },
          });
          if (claimed.count === 0) {
            return;
          }

          await this.inventory.release(tx, movements);
          released += 1;
        });
      } catch (error) {
        this.logger.error({ err: error, quoteId: quote.id }, 'failed to expire a quote');
      }
    }

    return released;
  }

  /** Spec 4.4 and 6.2: a payment that never confirms frees its stock. */
  async expireOrders(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.client.order.findMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      select: { id: true, paymentRef: true },
      take: BATCH_SIZE,
    });

    let count = 0;
    for (const order of expired) {
      if (!order.paymentRef) {
        continue;
      }
      try {
        const result = await this.orders.settle(order.paymentRef, 'EXPIRED');
        if (result.applied) {
          count += 1;
        }
      } catch (error) {
        this.logger.error({ err: error, orderId: order.id }, 'failed to expire an order');
      }
    }

    return count;
  }
}
