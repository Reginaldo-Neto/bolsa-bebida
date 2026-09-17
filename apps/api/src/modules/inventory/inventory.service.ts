import type { PrismaTransaction } from '@bolsa/db';
import { DomainError } from '@bolsa/shared';
import { Injectable } from '@nestjs/common';

export interface StockMovement {
  productId: string;
  qty: number;
}

/**
 * Stock has three counters: available, reserved and sold (spec 4.2). Every
 * move is a conditional UPDATE inside a transaction, so the database decides
 * who gets the last drink. Redis is a cache and is never the source of truth
 * for stock or money (spec 8.3).
 */
@Injectable()
export class InventoryService {
  /**
   * available -> reserved. Fails if any product cannot cover the quantity,
   * rolling back the whole basket: a half-reserved cart is worse than none.
   */
  async reserve(tx: PrismaTransaction, items: readonly StockMovement[]): Promise<void> {
    for (const item of sortedByProduct(items)) {
      const result = await tx.product.updateMany({
        where: { id: item.productId, archived: false, stockAvailable: { gte: item.qty } },
        data: {
          stockAvailable: { decrement: item.qty },
          stockReserved: { increment: item.qty },
        },
      });

      if (result.count === 0) {
        await this.throwInsufficient(tx, item);
      }
    }
  }

  /** reserved -> available, when a payment fails or expires (spec 6.2). */
  async release(tx: PrismaTransaction, items: readonly StockMovement[]): Promise<void> {
    for (const item of sortedByProduct(items)) {
      const result = await tx.product.updateMany({
        where: { id: item.productId, stockReserved: { gte: item.qty } },
        data: {
          stockReserved: { decrement: item.qty },
          stockAvailable: { increment: item.qty },
        },
      });

      if (result.count === 0) {
        throw new DomainError('internal-error', 'Nao foi possivel libertar o stock reservado.', {
          productId: item.productId,
          qty: item.qty,
        });
      }
    }
  }

  /** reserved -> sold, once the payment is confirmed. */
  async commit(tx: PrismaTransaction, items: readonly StockMovement[]): Promise<void> {
    for (const item of sortedByProduct(items)) {
      const result = await tx.product.updateMany({
        where: { id: item.productId, stockReserved: { gte: item.qty } },
        data: {
          stockReserved: { decrement: item.qty },
          stockSold: { increment: item.qty },
        },
      });

      if (result.count === 0) {
        throw new DomainError('internal-error', 'Nao foi possivel confirmar a venda do stock.', {
          productId: item.productId,
          qty: item.qty,
        });
      }
    }
  }

  /**
   * sold -> available, for a refund. The units go back on sale rather than
   * vanishing, so the engine keeps seeing a truthful stock level.
   */
  async restock(tx: PrismaTransaction, items: readonly StockMovement[]): Promise<void> {
    for (const item of sortedByProduct(items)) {
      await tx.product.updateMany({
        where: { id: item.productId, stockSold: { gte: item.qty } },
        data: {
          stockSold: { decrement: item.qty },
          stockAvailable: { increment: item.qty },
        },
      });
    }
  }

  /** Spec 6.4: refuse with the quantity that is actually available. */
  private async throwInsufficient(tx: PrismaTransaction, item: StockMovement): Promise<never> {
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: { name: true, stockAvailable: true },
    });

    if (!product) {
      throw new DomainError('not-found', 'Produto nao encontrado.', {
        productId: item.productId,
      });
    }

    throw new DomainError(
      product.stockAvailable === 0 ? 'product-sold-out' : 'insufficient-stock',
      product.stockAvailable === 0
        ? `${product.name} esgotou.`
        : `Só restam ${product.stockAvailable} de ${product.name}.`,
      { productId: item.productId, requested: item.qty, available: product.stockAvailable },
    );
  }
}

/**
 * A stable lock order across transactions. Two carts holding the same two
 * products in opposite orders would otherwise deadlock each other.
 */
function sortedByProduct(items: readonly StockMovement[]): StockMovement[] {
  return [...items].sort((a, b) => a.productId.localeCompare(b.productId));
}
