import {
  changeForCash,
  DomainError,
  type CounterPaymentMethod,
  type CounterQuoteRequest,
  type CounterSaleRequest,
  type QuoteResponse,
} from '@bolsa/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { StaffContext } from '../auth/auth.service';
import { EventsService } from '../events/events.service';
import { OrdersService, type OrderSummary } from '../orders/orders.service';
import { ParticipantsService } from '../participants/participants.service';
import { QuotesService } from '../quotes/quotes.service';

export interface CounterSaleResult {
  order: OrderSummary;
  method: CounterPaymentMethod;
  cashReceivedCents: number | null;
  /** What to hand back, worked out by the server rather than in someone's head. */
  changeCents: number | null;
}

/**
 * The till.
 *
 * Not everyone at a party pays with their phone. Someone hands over a twenty,
 * or taps a card on the bar's own terminal, and neither of those touches this
 * application: the money is already taken by the time the cashier confirms.
 *
 * What the till must not become is a second, looser way to sell. It uses the
 * same quote, the same reserved stock, the same voucher and the same fiscal
 * document as a purchase made on a phone, so a counter sale moves the market
 * exactly as much as any other sale and the end of the night adds up.
 */
@Injectable()
export class CounterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly participants: ParticipantsService,
    private readonly quotes: QuotesService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * L1: the price is locked before the notes are counted, and the countdown is
   * on the cashier's screen. A quote that runs out is re-made at the current
   * price, which is the same rule the participant gets.
   */
  async quote(staff: StaffContext, request: CounterQuoteRequest): Promise<QuoteResponse> {
    await this.events.requirePurchasable(staff.eventId);

    const customer = await this.participants.createCounterCustomer(
      staff.eventId,
      request.ageChecked,
    );

    return this.quotes.create(customer, { items: request.items });
  }

  async sell(staff: StaffContext, request: CounterSaleRequest): Promise<CounterSaleResult> {
    await this.events.requirePurchasable(staff.eventId);

    const quote = await this.prisma.client.quote.findUnique({
      where: { id: request.quoteId },
      include: { participant: true },
    });

    // A cashier settling somebody's phone order would be taking money for a
    // purchase that is already going to be charged, so the till only ever
    // settles quotes the till itself made, at its own event.
    if (!quote || !quote.participant.isCounter || quote.participant.eventId !== staff.eventId) {
      throw new DomainError('not-found', 'Cotacao nao encontrada.');
    }

    // Cash is optional even for a cash sale: exact money needs no arithmetic.
    // When it is given, it has to cover the total, and the price may have
    // moved between the quote and the notes being counted.
    const cashReceivedCents = request.cashReceivedCents ?? null;

    if (request.method === 'CASH' && cashReceivedCents !== null) {
      if (cashReceivedCents < quote.totalCents) {
        throw new DomainError(
          'validation-failed',
          'O dinheiro recebido e inferior ao total a pagar.',
          { totalCents: quote.totalCents, cashReceivedCents },
        );
      }
    }

    const changeCents =
      request.method === 'CASH' && cashReceivedCents !== null
        ? changeForCash(quote.totalCents, cashReceivedCents)
        : null;

    const order = await this.orders.createAtCounter({
      participant: {
        id: quote.participant.id,
        eventId: quote.participant.eventId,
        nickname: quote.participant.nickname,
        isAdultDeclared: quote.participant.isAdultDeclared,
        leaderboardOptIn: quote.participant.leaderboardOptIn,
        teamCode: quote.participant.teamCode,
      },
      quoteId: quote.id,
      method: request.method,
      staffUserId: staff.id,
      cashReceivedCents,
      nif: request.nif ?? null,
    });

    // Spec 12.2: who took the money, how much, and in what form. This is the
    // line the organiser counts the drawer against at the end of the night.
    await this.audit.record({
      eventId: staff.eventId,
      actorType: staff.role === 'ADMIN' ? 'ADMIN' : 'STAFF',
      actorId: staff.id,
      action: 'counter.sale',
      entity: 'order',
      entityId: order.id,
      after: {
        method: request.method,
        totalCents: order.totalCents,
        cashReceivedCents,
        changeCents,
        items: order.items.map((item) => ({ name: item.name, qty: item.qty })),
      },
    });

    return { order, method: request.method, cashReceivedCents, changeCents };
  }
}
