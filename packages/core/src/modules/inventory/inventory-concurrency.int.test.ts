import type { PrismaClient } from '@bolsa/db';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedEvent, sessionCookieFrom, type SeededEvent } from '../../test/app';
import {
  describeWithDatabase,
  resetDatabase,
  TEST_DATABASE_IS_SERIALIZED,
  testPrismaClient,
} from '../../test/database';

/**
 * F2 acceptance (spec 13.1): 200 simultaneous purchases must never leave the
 * stock negative and must never sell more units than exist.
 */
describeWithDatabase('stock under concurrency', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  let event: SeededEvent;

  beforeAll(async () => {
    client = testPrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await client.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(client);
  });

  async function joinAs(nickname: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.eventId}/join`,
      payload: { nickname, isAdult: true },
    });
    return sessionCookieFrom(response.headers as Record<string, unknown>);
  }

  it('never oversells when 200 participants race for 50 drinks', async () => {
    event = await seedEvent(client, {
      products: [
        { name: 'Fino', basePriceCents: 150, stock: 50 },
        { name: 'Cidra', basePriceCents: 200, stock: 500 },
      ],
      limits: { alcoholUnitsPerWindow: 50 },
    });
    const fino = event.products[0];
    expect(fino).toBeDefined();

    const cookies = await Promise.all(
      Array.from({ length: 200 }, (_, index) => joinAs(`p${index}`)),
    );

    const results = await Promise.all(
      cookies.map((cookie) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/quotes',
          headers: { cookie },
          payload: { items: [{ productId: fino?.id, qty: 1 }] },
        }),
      ),
    );

    const accepted = results.filter((result) => result.statusCode === 201);
    const refused = results.filter((result) => result.statusCode === 409);

    // The guarantee of spec 13.1: exactly as many sales as there were drinks.
    expect(accepted).toHaveLength(50);
    for (const result of refused) {
      expect(['insufficient-stock', 'product-sold-out']).toContain(result.json().code);
    }

    if (!TEST_DATABASE_IS_SERIALIZED) {
      // Every other participant got a clear refusal rather than an error.
      expect(refused).toHaveLength(150);
    }

    const product = await client.product.findUniqueOrThrow({ where: { id: fino?.id } });
    expect(product.stockAvailable).toBe(0);
    expect(product.stockReserved).toBe(50);
    expect(product.stockSold).toBe(0);
    expect(product.stockAvailable + product.stockReserved + product.stockSold).toBe(
      product.stockInitial,
    );
  }, 120_000);

  it('keeps the counters consistent when carts mix several products', async () => {
    event = await seedEvent(client, {
      products: [
        { name: 'Fino', basePriceCents: 150, stock: 40 },
        { name: 'Cidra', basePriceCents: 200, stock: 40 },
      ],
      limits: { alcoholUnitsPerWindow: 50, maxQtyPerProduct: 4 },
    });
    const [fino, cidra] = event.products;

    const cookies = await Promise.all(
      Array.from({ length: 60 }, (_, index) => joinAs(`mix${index}`)),
    );

    // Half the carts list the products in the opposite order: without a stable
    // lock order these transactions would deadlock each other.
    await Promise.all(
      cookies.map((cookie, index) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/quotes',
          headers: { cookie },
          payload: {
            items:
              index % 2 === 0
                ? [
                    { productId: fino?.id, qty: 1 },
                    { productId: cidra?.id, qty: 1 },
                  ]
                : [
                    { productId: cidra?.id, qty: 1 },
                    { productId: fino?.id, qty: 1 },
                  ],
          },
        }),
      ),
    );

    for (const id of [fino?.id, cidra?.id]) {
      const product = await client.product.findUniqueOrThrow({ where: { id: id ?? '' } });
      expect(product.stockAvailable).toBeGreaterThanOrEqual(0);
      expect(product.stockAvailable + product.stockReserved + product.stockSold).toBe(
        product.stockInitial,
      );
    }
  }, 120_000);

  it('refuses to oversell even if the application tries, thanks to the CHECK constraint', async () => {
    event = await seedEvent(client, {
      products: [{ name: 'Fino', basePriceCents: 150, stock: 1 }],
    });
    const fino = event.products[0];

    await expect(
      client.product.update({
        where: { id: fino?.id ?? '' },
        data: { stockAvailable: -1 },
      }),
    ).rejects.toThrow();
  });
});
