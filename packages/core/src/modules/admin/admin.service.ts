import { newId } from '@bolsa/db';
import {
  DomainError,
  canTransitionEvent,
  engineParamsPatchSchema,
  eventRoom,
  parseEngineParams,
  type EventAction,
  type EventStatus,
  type ProductInput,
} from '@bolsa/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { StaffContext } from '../auth/auth.service';
import { EventsService, type EventContext } from '../events/events.service';
import { InventoryService } from '../inventory/inventory.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';

export interface AdminAlert {
  level: 'warning' | 'error';
  code: 'tick-overdue' | 'low-stock' | 'payment-stuck' | 'invoice-failed';
  message: string;
}

export interface AdminMetricsView {
  /** Spec 13.3: what should make someone look up from the bar. */
  alerts: AdminAlert[];
  status: string;
  fixedPrices: boolean;
  engineParams: Record<string, number | boolean>;
  revenueCents: number;
  unitsSold: number;
  pendingOrders: number;
  lowStockProducts: number;
  lastTickAt: string | null;
  products: {
    id: string;
    name: string;
    priceCents: number;
    basePriceCents: number;
    stockAvailable: number;
    stockReserved: number;
    stockSold: number;
    unitsSold: number;
  }[];
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /**
   * Spec 4.1: the lifecycle, plus the emergency switch. FIXED_PRICES is not a
   * status: it stops the engine and sends every quote back to its base price,
   * whichever state the event is in.
   */
  async changeState(
    staff: StaffContext,
    action: EventAction['action'],
  ): Promise<{ status: EventStatus; fixedPrices: boolean }> {
    const event = await this.events.findById(staff.eventId);

    if (action === 'FIXED_PRICES' || action === 'RESUME_PRICES') {
      const fixedPrices = action === 'FIXED_PRICES';

      await this.prisma.client.$transaction(async (tx) => {
        await tx.event.update({ where: { id: event.id }, data: { fixedPrices } });

        if (fixedPrices) {
          const products = await tx.product.findMany({
            where: { eventId: event.id },
            select: { id: true, basePriceCents: true },
          });
          for (const product of products) {
            await tx.productEngineState.update({
              where: { productId: product.id },
              data: {
                currentPriceCents: product.basePriceCents,
                rawPrice: product.basePriceCents,
                overridePriceCents: null,
                overrideUntilTick: null,
              },
            });
          }
        }
      });

      await this.record(staff, 'event.fixed_prices', 'event', event.id, {
        before: { fixedPrices: event.fixedPrices },
        after: { fixedPrices },
      });
      this.announceState(event.id, event.status, fixedPrices);

      return { status: event.status, fixedPrices };
    }

    if (!canTransitionEvent(event.status, action)) {
      throw new DomainError(
        'validation-failed',
        `Nao e possivel passar de ${event.status} para ${action}.`,
      );
    }

    await this.prisma.client.event.update({
      where: { id: event.id },
      data: { status: action },
    });

    await this.record(staff, 'event.state', 'event', event.id, {
      before: { status: event.status },
      after: { status: action },
    });
    this.announceState(event.id, action, event.fixedPrices);

    return { status: action, fixedPrices: event.fixedPrices };
  }

  /** Spec 4.7: parameters take effect on the next tick, never retroactively. */
  async updateEngineParams(staff: StaffContext, patch: unknown) {
    const event = await this.events.findById(staff.eventId);
    const parsed = engineParamsPatchSchema.parse(patch);
    const next = parseEngineParams({ ...event.engineParams, ...parsed });

    await this.prisma.client.event.update({
      where: { id: event.id },
      data: { engineParams: next },
    });

    await this.record(staff, 'event.engine_params', 'event', event.id, {
      before: event.engineParams,
      after: next,
    });

    return next;
  }

  /** Spec 4.7: pin a price, always inside the published range (L2). */
  async overridePrice(
    staff: StaffContext,
    productId: string,
    input: { priceCents: number; ticks: number },
  ) {
    const event = await this.events.findById(staff.eventId);
    const product = await this.requireProduct(staff.eventId, productId);

    if (input.priceCents < product.minPriceCents || input.priceCents > product.maxPriceCents) {
      throw new DomainError(
        'price-out-of-range',
        `O preco tem de estar entre ${product.minPriceCents} e ${product.maxPriceCents} centimos.`,
        { minPriceCents: product.minPriceCents, maxPriceCents: product.maxPriceCents },
      );
    }

    const untilTick = event.currentTick + input.ticks;
    await this.prisma.client.productEngineState.update({
      where: { productId },
      data: { overridePriceCents: input.priceCents, overrideUntilTick: untilTick },
    });

    await this.record(staff, 'product.override', 'product', productId, {
      after: { priceCents: input.priceCents, untilTick },
    });

    return { productId, priceCents: input.priceCents, untilTick };
  }

  /** Spec 4.2: a manual stock correction always carries a reason. */
  async adjustStock(
    staff: StaffContext,
    productId: string,
    input: { delta: number; reason: string },
  ) {
    const product = await this.requireProduct(staff.eventId, productId);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.product.updateMany({
        where: {
          id: productId,
          ...(input.delta < 0 ? { stockAvailable: { gte: -input.delta } } : {}),
        },
        data: {
          stockAvailable: { increment: input.delta },
          stockInitial: { increment: Math.max(0, input.delta) },
        },
      });

      if (result.count === 0) {
        throw new DomainError(
          'insufficient-stock',
          'Nao ha stock disponivel suficiente para retirar.',
        );
      }

      return tx.product.findUniqueOrThrow({ where: { id: productId } });
    });

    await this.record(staff, 'product.stock_adjust', 'product', productId, {
      before: { stockAvailable: product.stockAvailable },
      after: { stockAvailable: updated.stockAvailable, delta: input.delta, reason: input.reason },
    });

    return updated;
  }

  /** Spec 4.7 and 4.5: refund an order, optionally putting the drinks back. */
  async refund(
    staff: StaffContext,
    orderId: string,
    input: { amountCents?: number; reason: string; restock: boolean },
  ) {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, participant: { eventId: staff.eventId } },
      include: { items: true, refunds: true },
    });

    if (!order) {
      throw new DomainError('not-found', 'Encomenda nao encontrada.');
    }
    if (order.status !== 'PAID' && order.status !== 'PARTIALLY_REDEEMED') {
      throw new DomainError('validation-failed', 'So encomendas pagas podem ser reembolsadas.');
    }

    const alreadyRefunded = order.refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
    const amountCents = input.amountCents ?? order.totalCents - alreadyRefunded;

    if (amountCents <= 0 || alreadyRefunded + amountCents > order.totalCents) {
      throw new DomainError('validation-failed', 'Valor de reembolso invalido.');
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.refund.create({
        data: {
          id: newId(),
          orderId: order.id,
          amountCents,
          reason: input.reason,
          adminUserId: staff.id,
        },
      });

      if (input.restock) {
        // Only what was never handed over goes back on sale.
        const movements = order.items
          .map((item) => ({ productId: item.productId, qty: item.qty - item.redeemedQty }))
          .filter((movement) => movement.qty > 0);
        if (movements.length > 0) {
          await this.inventory.restock(tx, movements);
        }
      }

      await tx.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
      await tx.voucher.updateMany({
        where: { orderId: order.id },
        data: { status: 'REFUNDED' },
      });
    });

    await this.record(staff, 'order.refund', 'order', order.id, {
      after: { amountCents, reason: input.reason, restock: input.restock },
    });

    return { orderId: order.id, amountCents };
  }

  /** Spec 4.7: the live dashboard. */
  async metrics(eventId: string): Promise<AdminMetricsView> {
    const event = await this.events.findById(eventId);

    const [products, paidItems, pendingOrders, stuckPayments, failedInvoices] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { eventId, archived: false },
        include: { engineState: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.client.orderItem.findMany({
        where: {
          product: { eventId },
          order: { status: { in: ['PAID', 'PARTIALLY_REDEEMED', 'REDEEMED'] } },
        },
        select: { productId: true, qty: true, unitPriceCents: true },
      }),
      this.prisma.client.order.count({
        where: { participant: { eventId }, status: 'PENDING' },
      }),
      // A payment still pending long after it was started means the gateway's
      // webhook never arrived (spec 13.3).
      this.prisma.client.payment.count({
        where: {
          status: 'PENDING',
          createdAt: { lt: new Date(Date.now() - 60_000) },
          order: { participant: { eventId } },
        },
      }),
      this.prisma.client.invoice.count({
        where: { status: 'FAILED', order: { participant: { eventId } } },
      }),
    ]);

    const soldByProduct = new Map<string, number>();
    let revenueCents = 0;
    let unitsSold = 0;

    for (const item of paidItems) {
      revenueCents += item.unitPriceCents * item.qty;
      unitsSold += item.qty;
      soldByProduct.set(item.productId, (soldByProduct.get(item.productId) ?? 0) + item.qty);
    }

    const lowStock = products.filter(
      (product) => product.stockInitial > 0 && product.stockAvailable / product.stockInitial < 0.1,
    );

    return {
      alerts: this.buildAlerts(event, { lowStock, stuckPayments, failedInvoices }),
      status: event.status,
      fixedPrices: event.fixedPrices,
      engineParams: { ...event.engineParams },
      revenueCents,
      unitsSold,
      pendingOrders,
      lowStockProducts: products.filter(
        (product) =>
          product.stockInitial > 0 && product.stockAvailable / product.stockInitial < 0.1,
      ).length,
      lastTickAt: event.lastTickAt?.toISOString() ?? null,
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        priceCents: product.engineState?.currentPriceCents ?? product.basePriceCents,
        basePriceCents: product.basePriceCents,
        stockAvailable: product.stockAvailable,
        stockReserved: product.stockReserved,
        stockSold: product.stockSold,
        unitsSold: soldByProduct.get(product.id) ?? 0,
      })),
    };
  }

  /** Spec 13.3: the four things worth interrupting the organiser for. */
  private buildAlerts(
    event: EventContext,
    counts: {
      lowStock: { name: string }[];
      stuckPayments: number;
      failedInvoices: number;
    },
  ): AdminAlert[] {
    const alerts: AdminAlert[] = [];

    // A market that stopped moving while it is open means the worker died.
    if (event.status === 'OPEN' && !event.fixedPrices) {
      const overdueAfter = event.engineParams.tickSeconds * 2 * 1000;
      const since = event.lastTickAt ? Date.now() - event.lastTickAt.getTime() : Infinity;

      if (since > overdueAfter) {
        alerts.push({
          level: 'error',
          code: 'tick-overdue',
          message: event.lastTickAt
            ? `As cotacoes nao sao atualizadas ha ${Math.round(since / 60000)} minutos. O worker esta a correr?`
            : 'As cotacoes ainda nao comecaram a ser atualizadas. O worker esta a correr?',
        });
      }
    }

    if (counts.lowStock.length > 0) {
      alerts.push({
        level: 'warning',
        code: 'low-stock',
        message: `Abaixo de 10% de stock: ${counts.lowStock.map((product) => product.name).join(', ')}.`,
      });
    }

    if (counts.stuckPayments > 0) {
      alerts.push({
        level: 'warning',
        code: 'payment-stuck',
        message: `${counts.stuckPayments} pagamento(s) sem confirmacao ha mais de um minuto.`,
      });
    }

    // L6: a sale with no fiscal document is a legal problem, not a glitch.
    if (counts.failedInvoices > 0) {
      alerts.push({
        level: 'error',
        code: 'invoice-failed',
        message: `${counts.failedInvoices} documento(s) fiscal(is) por emitir apos varias tentativas.`,
      });
    }

    return alerts;
  }

  async createProduct(staff: StaffContext, input: ProductInput) {
    const group = await this.prisma.client.productGroup.upsert({
      where: { eventId_name: { eventId: staff.eventId, name: input.groupName } },
      update: {},
      create: { id: newId(), eventId: staff.eventId, name: input.groupName },
    });

    const product = await this.prisma.client.product.create({
      data: {
        id: newId(),
        eventId: staff.eventId,
        groupId: group.id,
        name: input.name,
        category: input.category ?? null,
        isAlcoholic: input.isAlcoholic,
        volumeMl: input.volumeMl ?? null,
        costCents: input.costCents,
        basePriceCents: input.basePriceCents,
        minPriceCents: input.minPriceCents,
        maxPriceCents: input.maxPriceCents,
        stockInitial: input.stockInitial,
        stockAvailable: input.stockInitial,
        sortOrder: input.sortOrder ?? 0,
        imageUrl: input.imageUrl ?? null,
        engineState: {
          create: {
            currentPriceCents: input.basePriceCents,
            rawPrice: input.basePriceCents,
          },
        },
      },
    });

    await this.record(staff, 'product.create', 'product', product.id, { after: input });
    return product;
  }

  async updateProduct(staff: StaffContext, productId: string, input: Partial<ProductInput>) {
    const before = await this.requireProduct(staff.eventId, productId);

    const next = {
      minPriceCents: input.minPriceCents ?? before.minPriceCents,
      basePriceCents: input.basePriceCents ?? before.basePriceCents,
      maxPriceCents: input.maxPriceCents ?? before.maxPriceCents,
    };
    if (next.minPriceCents > next.basePriceCents || next.basePriceCents > next.maxPriceCents) {
      throw new DomainError(
        'validation-failed',
        'O preco base tem de estar entre o minimo e o maximo.',
      );
    }

    const product = await this.prisma.client.product.update({
      where: { id: productId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.isAlcoholic !== undefined ? { isAlcoholic: input.isAlcoholic } : {}),
        ...(input.volumeMl !== undefined ? { volumeMl: input.volumeMl } : {}),
        ...(input.costCents !== undefined ? { costCents: input.costCents } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...next,
      },
    });

    await this.record(staff, 'product.update', 'product', productId, { before, after: input });
    return product;
  }

  async archiveProduct(staff: StaffContext, productId: string) {
    await this.requireProduct(staff.eventId, productId);
    const product = await this.prisma.client.product.update({
      where: { id: productId },
      data: { archived: true },
    });

    await this.record(staff, 'product.archive', 'product', productId, {});
    return product;
  }

  private async requireProduct(eventId: string, productId: string) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, eventId },
    });
    if (!product) {
      throw new DomainError('not-found', 'Produto nao encontrado.');
    }
    return product;
  }

  private announceState(eventId: string, status: EventStatus, fixedPrices: boolean): void {
    this.realtime.publish(eventRoom(eventId), 'market.state', { eventId, status, fixedPrices });
  }

  private async record(
    staff: StaffContext,
    action: string,
    entity: string,
    entityId: string,
    payload: { before?: unknown; after?: unknown },
  ): Promise<void> {
    await this.audit.record({
      eventId: staff.eventId,
      actorType: 'ADMIN',
      actorId: staff.id,
      action,
      entity,
      entityId,
      ...payload,
    });
  }
}
