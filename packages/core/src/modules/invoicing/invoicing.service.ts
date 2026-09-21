import { newId, type PrismaTransaction } from '@bolsa/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { INVOICING_PROVIDER, type InvoicingProvider } from './invoicing-provider';

/** Spec 8.2: a queue with retries, because the tax API will be down at some point. */
const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 25;

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(INVOICING_PROVIDER) private readonly provider: InvoicingProvider,
  ) {}

  /**
   * Queues the fiscal document for a paid order. Called inside the payment
   * transaction: an order that is paid and has no invoice row queued would be
   * a sale with no document and no record that one is owed (L6).
   */
  async enqueue(tx: PrismaTransaction, orderId: string): Promise<void> {
    await tx.invoice.upsert({
      where: { orderId },
      update: {},
      create: { id: newId(), orderId, provider: this.provider.name, status: 'PENDING' },
    });
  }

  /**
   * Issues whatever is still owed. Runs on the worker; safe to call repeatedly.
   */
  async processPending(now: Date = new Date()): Promise<{ issued: number; failed: number }> {
    const pending = await this.prisma.client.invoice.findMany({
      where: { status: 'PENDING', attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      include: {
        order: {
          include: {
            items: { include: { product: true } },
            participant: { select: { nickname: true, event: { select: { name: true } } } },
          },
        },
      },
    });

    let issued = 0;
    let failed = 0;

    for (const invoice of pending) {
      // Claimed with a conditional update, so two workers never issue the same
      // document twice.
      const claimed = await this.prisma.client.invoice.updateMany({
        where: { id: invoice.id, status: 'PENDING', attempts: invoice.attempts },
        data: { attempts: { increment: 1 } },
      });
      if (claimed.count === 0) {
        continue;
      }

      try {
        const result = await this.provider.issue({
          orderId: invoice.orderId,
          eventName: invoice.order.participant.event.name,
          issuedAt: now,
          customerNif: invoice.order.nif,
          customerName: invoice.order.participant.nickname,
          totalCents: invoice.order.totalCents,
          lines: invoice.order.items.map((item) => ({
            description: item.product.name,
            quantity: item.qty,
            unitPriceCents: item.unitPriceCents,
            vatBasisPoints: item.product.vatBasisPoints,
          })),
        });

        await this.prisma.client.invoice.update({
          where: { id: invoice.id },
          data: { status: 'ISSUED', documentNumber: result.documentNumber, lastError: null },
        });
        issued += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);

        await this.prisma.client.invoice.update({
          where: { id: invoice.id },
          data: {
            lastError: message.slice(0, 500),
            // Only give up after MAX_ATTEMPTS; until then it stays queued.
            status: invoice.attempts + 1 >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          },
        });

        this.logger.warn(
          `tentativa ${invoice.attempts + 1} de emitir o documento da encomenda ` +
            `${invoice.orderId} falhou: ${message}`,
        );
      }
    }

    return { issued, failed };
  }

  /** Spec 13.3: what the admin panel needs to raise an alarm. */
  async health(eventId: string): Promise<{ pending: number; failed: number }> {
    const [pending, failed] = await Promise.all([
      this.prisma.client.invoice.count({
        where: { status: 'PENDING', order: { participant: { eventId } } },
      }),
      this.prisma.client.invoice.count({
        where: { status: 'FAILED', order: { participant: { eventId } } },
      }),
    ]);

    return { pending, failed };
  }
}
