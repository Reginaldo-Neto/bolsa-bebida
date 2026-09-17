import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider';

const BATCH_SIZE = 100;

/**
 * Spec 6.1: "Se o webhook não chegar, um job consulta o estado no gateway".
 * Venue wifi drops, gateways retry badly, and a participant holding a paid
 * receipt with no voucher is the worst failure this system can produce.
 */
@Injectable()
export class PaymentPollerService {
  private readonly logger = new Logger(PaymentPollerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async pollPending(): Promise<{ checked: number; settled: number }> {
    const pending = await this.prisma.client.payment.findMany({
      where: { status: 'PENDING', provider: this.provider.name },
      select: { providerRef: true },
      take: BATCH_SIZE,
    });

    let settled = 0;
    for (const payment of pending) {
      try {
        const status = await this.provider.getStatus(payment.providerRef);
        if (status === 'PENDING') {
          continue;
        }

        const result = await this.orders.settle(payment.providerRef, status, {
          raw: { source: 'poll', status },
        });
        if (result.applied) {
          settled += 1;
        }
      } catch (error) {
        this.logger.warn(
          { err: error, providerRef: payment.providerRef },
          'could not read a payment status from the gateway',
        );
      }
    }

    return { checked: pending.length, settled };
  }
}
