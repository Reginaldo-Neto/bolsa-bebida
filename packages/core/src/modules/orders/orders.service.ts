import { newId } from '@bolsa/db';
import {
  DomainError,
  type OrderRequest,
  type PaymentStatus,
  type QuoteItem,
  canTransitionOrder,
  participantRoom,
} from '@bolsa/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { EventsService } from '../events/events.service';
import { InventoryService, type StockMovement } from '../inventory/inventory.service';
import type { ParticipantContext } from '../participants/participants.service';
import { ParticipantsService } from '../participants/participants.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/payment-provider';
import { InvoicingService } from '../invoicing/invoicing.service';
import { QuotesService } from '../quotes/quotes.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { VouchersService } from '../vouchers/vouchers.service';

export interface OrderSummary {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
  expiresAt: string;
  /** The gateway's own reference. The mock provider's dev route needs it. */
  paymentRef: string | null;
  items: {
    id: string;
    productId: string;
    name: string;
    qty: number;
    unitPriceCents: number;
    redeemedQty: number;
  }[];
  voucher: { id: string; shortCode: string; qr: string; status: string } | null;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly quotes: QuotesService,
    private readonly inventory: InventoryService,
    private readonly vouchers: VouchersService,
    private readonly participants: ParticipantsService,
    private readonly realtime: RealtimePublisher,
    private readonly invoicing: InvoicingService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  /**
   * Spec 6.1: consuming a quote turns the locked prices into an order and
   * starts the payment. The stock is already reserved by the quote, so nothing
   * here can oversell.
   */
  async create(participant: ParticipantContext, request: OrderRequest): Promise<OrderSummary> {
    const event = await this.events.requirePurchasable(participant.eventId);
    const quote = await this.quotes.consumableQuote(request.quoteId, participant.id);
    const items = quote.items as unknown as QuoteItem[];

    const expiresAt = new Date(Date.now() + event.limits.paymentTimeoutSeconds * 1000);

    const order = await this.prisma.client.$transaction(async (tx) => {
      // Consuming the quote is conditional, so two taps on "pay" cannot create
      // two orders from the same reservation.
      const consumed = await tx.quote.updateMany({
        where: { id: quote.id, status: 'ACTIVE' },
        data: { status: 'CONSUMED' },
      });
      if (consumed.count === 0) {
        throw new DomainError('quote-already-used', 'Esta cotacao ja deu origem a uma encomenda.');
      }

      return tx.order.create({
        data: {
          id: newId(),
          participantId: participant.id,
          quoteId: quote.id,
          status: 'PENDING',
          totalCents: quote.totalCents,
          nif: request.nif ?? null,
          expiresAt,
          items: {
            create: items.map((item) => ({
              id: newId(),
              productId: item.productId,
              qty: item.qty,
              unitPriceCents: item.unitPriceCents,
              basePriceCentsAtPurchase: item.basePriceCents,
            })),
          },
        },
        include: { items: true },
      });
    });

    // L7: the phone number reaches the gateway but is only ever stored hashed.
    await this.prisma.client.participant.update({
      where: { id: participant.id },
      data: { phoneHash: this.participants.hashPhone(request.phone) },
    });

    // Outside the transaction on purpose: a gateway that hangs must not hold
    // database locks on the stock rows.
    const result = await this.payments.charge({
      orderId: order.id,
      amountCents: order.totalCents,
      phone: request.phone,
      description: `${event.name} - encomenda ${order.id.slice(0, 8)}`,
    });

    await this.prisma.client.payment.create({
      data: {
        id: newId(),
        orderId: order.id,
        provider: this.payments.name,
        providerRef: result.providerRef,
        status: result.status,
        amountCents: order.totalCents,
      },
    });
    await this.prisma.client.order.update({
      where: { id: order.id },
      data: { paymentRef: result.providerRef },
    });

    if (result.status === 'PAID') {
      await this.settle(result.providerRef, 'PAID');
    }

    return this.summary(order.id);
  }

  /**
   * Applies a payment outcome. Keyed on providerRef and idempotent, because a
   * gateway will happily deliver the same webhook twice (spec 12.1).
   */
  async settle(
    providerRef: string,
    status: PaymentStatus,
    options: { raw?: unknown } = {},
  ): Promise<{ applied: boolean }> {
    if (status === 'PENDING') {
      return { applied: false };
    }

    const outcome = await this.prisma.client.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { providerRef },
        include: { order: { include: { items: true, voucher: true } } },
      });

      if (!payment) {
        throw new DomainError('not-found', 'Pagamento desconhecido.', { providerRef });
      }

      // Already resolved: acknowledge and do nothing.
      if (payment.status !== 'PENDING') {
        return { applied: false, participantId: null, orderId: null, status: null };
      }

      const order = payment.order;
      if (!canTransitionOrder(order.status, status === 'PAID' ? 'PAID' : statusToOrder(status))) {
        this.logger.warn(
          { orderId: order.id, from: order.status, to: status },
          'ignoring a payment outcome that the order cannot accept',
        );
        return { applied: false, participantId: null, orderId: null, status: null };
      }

      await tx.payment.update({
        where: { providerRef },
        data: {
          status,
          receivedAt: new Date(),
          ...(options.raw !== undefined ? { rawPayload: options.raw as object } : {}),
        },
      });

      const movements: StockMovement[] = order.items.map((item) => ({
        productId: item.productId,
        qty: item.qty,
      }));

      if (status === 'PAID') {
        await this.inventory.commit(tx, movements);
        await tx.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
        if (!order.voucher) {
          const participant = await tx.participant.findUniqueOrThrow({
            where: { id: order.participantId },
            select: { eventId: true },
          });
          await this.vouchers.issue(tx, order.id, participant.eventId);
        }

        // L6: queued in the same transaction as the payment. An order that is
        // paid with no invoice row would be a sale with no document owed to
        // anyone, and nothing to find it by later.
        await this.invoicing.enqueue(tx, order.id);
      } else {
        // Spec 6.2: FAILED and EXPIRED release the reserved stock immediately.
        await this.inventory.release(tx, movements);
        await tx.order.update({
          where: { id: order.id },
          data: { status: statusToOrder(status) },
        });
      }

      return {
        applied: true,
        participantId: order.participantId,
        orderId: order.id,
        status: status === 'PAID' ? 'PAID' : statusToOrder(status),
      };
    });

    // Published after the commit: a client told an order is paid must never
    // find a database that does not agree yet.
    if (outcome.applied && outcome.participantId && outcome.orderId) {
      this.realtime.publish(participantRoom(outcome.participantId), 'order.updated', {
        participantId: outcome.participantId,
        orderId: outcome.orderId,
        status: outcome.status ?? 'PAID',
      });
    }

    return { applied: outcome.applied };
  }

  async listForParticipant(participantId: string): Promise<OrderSummary[]> {
    const orders = await this.prisma.client.order.findMany({
      where: { participantId },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: true } }, voucher: true },
      take: 50,
    });

    return orders.map((order) => this.toSummary(order));
  }

  async summary(orderId: string): Promise<OrderSummary> {
    const order = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, voucher: true },
    });

    if (!order) {
      throw new DomainError('not-found', 'Encomenda nao encontrada.');
    }

    return this.toSummary(order);
  }

  private toSummary(order: {
    id: string;
    status: string;
    totalCents: number;
    createdAt: Date;
    expiresAt: Date;
    paymentRef: string | null;
    items: {
      id: string;
      productId: string;
      qty: number;
      unitPriceCents: number;
      redeemedQty: number;
      product: { name: string };
    }[];
    voucher: {
      id: string;
      eventId: string;
      shortCode: string;
      signature: string;
      status: string;
    } | null;
  }): OrderSummary {
    return {
      id: order.id,
      status: order.status,
      totalCents: order.totalCents,
      createdAt: order.createdAt.toISOString(),
      expiresAt: order.expiresAt.toISOString(),
      paymentRef: order.paymentRef,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        qty: item.qty,
        unitPriceCents: item.unitPriceCents,
        redeemedQty: item.redeemedQty,
      })),
      voucher: order.voucher
        ? {
            id: order.voucher.id,
            shortCode: order.voucher.shortCode,
            qr: this.vouchers.qrFor(order.voucher),
            status: order.voucher.status,
          }
        : null,
    };
  }
}

function statusToOrder(status: PaymentStatus): 'PAID' | 'FAILED' | 'EXPIRED' {
  switch (status) {
    case 'PAID':
      return 'PAID';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return 'FAILED';
  }
}
