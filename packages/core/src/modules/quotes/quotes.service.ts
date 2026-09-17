import { newId, type Quote } from '@bolsa/db';
import {
  addCents,
  DomainError,
  multiplyCents,
  type QuoteItem,
  type QuoteRequest,
  type QuoteResponse,
} from '@bolsa/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import type { EventContext } from '../events/events.service';
import { EventsService } from '../events/events.service';
import { InventoryService } from '../inventory/inventory.service';
import type { ParticipantContext } from '../participants/participants.service';

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Spec 4.4 and L1: creating a quote locks the price and reserves the stock
   * for a fixed window. The amount charged later is exactly the amount shown
   * here, whatever the market does in the meantime.
   */
  async create(participant: ParticipantContext, request: QuoteRequest): Promise<QuoteResponse> {
    const event = await this.events.requirePurchasable(participant.eventId);
    const items = mergeDuplicates(request.items);

    const products = await this.loadProducts(
      event.id,
      items.map((item) => item.productId),
    );

    this.assertQuantityLimits(items, event);
    this.assertAdultDeclaration(items, products, participant);
    await this.assertAlcoholAllowance(items, products, participant, event);

    const quoteItems = items.map((item): QuoteItem => {
      const product = products.get(item.productId);
      if (!product) {
        throw new DomainError('not-found', 'Produto nao encontrado.', {
          productId: item.productId,
        });
      }

      // The emergency switch of spec 4.1 sells everything at the base price.
      const unitPriceCents = event.fixedPrices
        ? product.basePriceCents
        : (product.engineState?.currentPriceCents ?? product.basePriceCents);

      return {
        productId: product.id,
        name: product.name,
        qty: item.qty,
        unitPriceCents,
        basePriceCents: product.basePriceCents,
        lineTotalCents: multiplyCents(unitPriceCents, item.qty),
      };
    });

    const totalCents = addCents(...quoteItems.map((item) => item.lineTotalCents));
    const expiresAt = new Date(Date.now() + event.limits.quoteTtlSeconds * 1000);

    const quote = await this.prisma.client.$transaction(async (tx) => {
      await this.inventory.reserve(tx, items);

      return tx.quote.create({
        data: {
          id: newId(),
          participantId: participant.id,
          items: quoteItems,
          totalCents,
          expiresAt,
        },
      });
    });

    return {
      id: quote.id,
      items: quoteItems,
      totalCents,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: event.limits.quoteTtlSeconds,
    };
  }

  /** Loads the quote for an order, refusing anything expired or already used. */
  async consumableQuote(quoteId: string, participantId: string): Promise<Quote> {
    const quote = await this.prisma.client.quote.findUnique({ where: { id: quoteId } });

    if (!quote || quote.participantId !== participantId) {
      throw new DomainError('not-found', 'Cotacao nao encontrada.');
    }
    if (quote.status === 'CONSUMED') {
      throw new DomainError('quote-already-used', 'Esta cotacao ja deu origem a uma encomenda.');
    }
    if (quote.status !== 'ACTIVE') {
      throw new DomainError('quote-expired', 'A cotacao expirou. Confirme os novos precos.');
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new DomainError('quote-expired', 'A cotacao expirou. Confirme os novos precos.');
    }

    return quote;
  }

  private async loadProducts(eventId: string, productIds: readonly string[]) {
    const products = await this.prisma.client.product.findMany({
      where: { id: { in: [...productIds] }, eventId, archived: false },
      include: { engineState: true },
    });

    if (products.length !== new Set(productIds).size) {
      throw new DomainError('not-found', 'Um dos produtos do carrinho nao existe neste evento.');
    }

    return new Map(products.map((product) => [product.id, product]));
  }

  /** Spec 4.4: a cap per product per order, to blunt arbitrage (spec 12.1). */
  private assertQuantityLimits(
    items: readonly { productId: string; qty: number }[],
    event: EventContext,
  ): void {
    for (const item of items) {
      if (item.qty > event.limits.maxQtyPerProduct) {
        throw new DomainError(
          'quantity-limit-exceeded',
          `Maximo de ${event.limits.maxQtyPerProduct} unidades por produto em cada encomenda.`,
          { productId: item.productId, limit: event.limits.maxQtyPerProduct },
        );
      }
    }
  }

  /** L5: no alcohol without the 18+ declaration. */
  private assertAdultDeclaration(
    items: readonly { productId: string; qty: number }[],
    products: Map<string, { isAlcoholic: boolean }>,
    participant: ParticipantContext,
  ): void {
    const hasAlcohol = items.some((item) => products.get(item.productId)?.isAlcoholic);
    if (hasAlcohol && !participant.isAdultDeclared) {
      throw new DomainError(
        'adult-declaration-required',
        'E necessario declarar que tem 18 anos ou mais para comprar bebidas alcoolicas.',
      );
    }
  }

  /**
   * L8: a configurable cap on alcoholic units per time window. Pending orders
   * count too, otherwise the cap could be walked around by leaving several
   * checkouts open at once.
   */
  private async assertAlcoholAllowance(
    items: readonly { productId: string; qty: number }[],
    products: Map<string, { isAlcoholic: boolean }>,
    participant: ParticipantContext,
    event: EventContext,
  ): Promise<void> {
    const requested = items
      .filter((item) => products.get(item.productId)?.isAlcoholic)
      .reduce((sum, item) => sum + item.qty, 0);

    if (requested === 0) {
      return;
    }

    const windowStart = new Date(Date.now() - event.limits.alcoholWindowMinutes * 60_000);
    const recent = await this.prisma.client.orderItem.findMany({
      where: {
        product: { isAlcoholic: true },
        order: {
          participantId: participant.id,
          createdAt: { gte: windowStart },
          status: { in: ['PENDING', 'PAID', 'PARTIALLY_REDEEMED', 'REDEEMED'] },
        },
      },
      select: { qty: true },
    });

    const alreadyBought = recent.reduce((sum, item) => sum + item.qty, 0);
    const limit = event.limits.alcoholUnitsPerWindow;

    if (alreadyBought + requested > limit) {
      throw new DomainError(
        'alcohol-limit-exceeded',
        `Limite de ${limit} bebidas alcoolicas por ${event.limits.alcoholWindowMinutes} minutos. ` +
          'Beba agua e volte daqui a pouco.',
        {
          limit,
          windowMinutes: event.limits.alcoholWindowMinutes,
          alreadyBought,
          requested,
        },
      );
    }
  }
}

/** Two lines of the same product become one, so the per-product cap holds. */
function mergeDuplicates(
  items: readonly { productId: string; qty: number }[],
): { productId: string; qty: number }[] {
  const merged = new Map<string, number>();
  for (const item of items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.qty);
  }
  return [...merged].map(([productId, qty]) => ({ productId, qty }));
}
