import {
  DomainError,
  eventAllowsPurchases,
  eventAllowsRedemptions,
  type EngineParams,
  type EventLimitsInput,
  type EventStatus,
  parseEngineParams,
  parseEventLimits,
} from '@bolsa/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/** An event with its JSON columns already validated. */
export interface EventContext {
  id: string;
  name: string;
  status: EventStatus;
  fixedPrices: boolean;
  currentTick: number;
  lastTickAt: Date | null;
  timezone: string;
  engineParams: EngineParams;
  limits: ReturnType<typeof parseEventLimits>;
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(eventId: string): Promise<EventContext> {
    const event = await this.prisma.client.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new DomainError('not-found', 'Evento nao encontrado.');
    }

    return {
      id: event.id,
      name: event.name,
      status: event.status,
      fixedPrices: event.fixedPrices,
      currentTick: event.currentTick,
      lastTickAt: event.lastTickAt,
      timezone: event.timezone,
      engineParams: parseEngineParams(event.engineParams),
      limits: parseEventLimits(event.limits as EventLimitsInput),
    };
  }

  /** Spec 4.1: purchases are allowed while OPEN or PAUSED (prices frozen). */
  async requirePurchasable(eventId: string): Promise<EventContext> {
    const event = await this.findById(eventId);

    if (!eventAllowsPurchases(event.status)) {
      throw new DomainError(
        event.status === 'CLOSED_SALES' || event.status === 'FINISHED'
          ? 'sales-closed'
          : 'event-not-open',
        'O mercado nao esta a aceitar compras neste momento.',
        { status: event.status },
      );
    }

    return event;
  }

  /** Spec 4.5: vouchers stay redeemable until the event is FINISHED. */
  async requireRedeemable(eventId: string): Promise<EventContext> {
    const event = await this.findById(eventId);

    if (!eventAllowsRedemptions(event.status)) {
      throw new DomainError('event-not-open', 'O evento ja terminou.', { status: event.status });
    }

    return event;
  }
}
