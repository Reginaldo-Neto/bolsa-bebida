import type { PrismaClient } from '@bolsa/db';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedEvent, sessionCookieFrom, type SeededEvent } from '../../test/app';
import { describeWithDatabase, resetDatabase, testPrismaClient } from '../../test/database';

/**
 * F2 acceptance: the whole participant journey through the API, with the mock
 * gateway standing in for MB WAY.
 */
describeWithDatabase('purchase flow', () => {
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
    event = await seedEvent(client);
  });

  async function join(nickname = 'Ana'): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.eventId}/join`,
      payload: { nickname, isAdult: true, leaderboardOptIn: true },
    });

    expect(response.statusCode).toBe(201);
    return sessionCookieFrom(response.headers as Record<string, unknown>);
  }

  it('goes from joining to a redeemable voucher', async () => {
    const cookie = await join();
    const fino = event.products[0];
    expect(fino).toBeDefined();

    const snapshot = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.eventId}/market/snapshot`,
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().products).toHaveLength(2);
    // L2: the published range travels with the price.
    expect(snapshot.json().products[0]).toMatchObject({
      minPriceCents: expect.any(Number),
      maxPriceCents: expect.any(Number),
    });

    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: fino?.id, qty: 2 }] },
    });
    expect(quote.statusCode).toBe(201);
    expect(quote.json().totalCents).toBe(300);
    expect(quote.json().ttlSeconds).toBe(60);

    // Stock moved from available to reserved, not to sold.
    const afterQuote = await client.product.findUniqueOrThrow({ where: { id: fino?.id } });
    expect(afterQuote.stockAvailable).toBe(98);
    expect(afterQuote.stockReserved).toBe(2);
    expect(afterQuote.stockSold).toBe(0);

    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie },
      payload: { quoteId: quote.json().id, phone: '912345678' },
    });
    expect(order.statusCode).toBe(201);
    expect(order.json().status).toBe('PENDING');
    expect(order.json().voucher).toBeNull();
    // L1: the amount charged is exactly the amount quoted.
    expect(order.json().totalCents).toBe(quote.json().totalCents);

    const payment = await client.payment.findFirstOrThrow({
      where: { orderId: order.json().id },
    });

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/dev/payments/${payment.providerRef}/PAID`,
      payload: {},
    });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().applied).toBe(true);

    const orders = await app.inject({
      method: 'GET',
      url: '/api/v1/me/orders',
      headers: { cookie },
    });
    expect(orders.json()[0].status).toBe('PAID');
    expect(orders.json()[0].voucher.qr).toMatch(/^BB1\./);
    expect(orders.json()[0].voucher.shortCode).toHaveLength(6);

    // Reserved stock became sold.
    const afterPayment = await client.product.findUniqueOrThrow({ where: { id: fino?.id } });
    expect(afterPayment.stockAvailable).toBe(98);
    expect(afterPayment.stockReserved).toBe(0);
    expect(afterPayment.stockSold).toBe(2);
  });

  it('releases the reserved stock when the payment fails (spec 6.2)', async () => {
    const cookie = await join();
    const fino = event.products[0];

    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: fino?.id, qty: 3 }] },
    });
    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie },
      payload: { quoteId: quote.json().id, phone: '912345678' },
    });
    const payment = await client.payment.findFirstOrThrow({
      where: { orderId: order.json().id },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/dev/payments/${payment.providerRef}/FAILED`,
      payload: {},
    });

    const product = await client.product.findUniqueOrThrow({ where: { id: fino?.id } });
    expect(product.stockAvailable).toBe(100);
    expect(product.stockReserved).toBe(0);
    expect(product.stockSold).toBe(0);

    const updated = await client.order.findUniqueOrThrow({ where: { id: order.json().id } });
    expect(updated.status).toBe('FAILED');
  });

  it('applies a repeated webhook only once (spec 12.1)', async () => {
    const cookie = await join();
    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: event.products[0]?.id, qty: 1 }] },
    });
    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie },
      payload: { quoteId: quote.json().id, phone: '912345678' },
    });
    const payment = await client.payment.findFirstOrThrow({
      where: { orderId: order.json().id },
    });

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/payments/mock`,
      payload: { providerRef: payment.providerRef, status: 'PAID' },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/payments/mock`,
      payload: { providerRef: payment.providerRef, status: 'PAID' },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    // One voucher, and the stock only moved once.
    const vouchers = await client.voucher.findMany({ where: { orderId: order.json().id } });
    expect(vouchers).toHaveLength(1);

    const product = await client.product.findUniqueOrThrow({
      where: { id: event.products[0]?.id },
    });
    expect(product.stockSold).toBe(1);
  });

  it('refuses a second order made from the same quote', async () => {
    const cookie = await join();
    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: event.products[0]?.id, qty: 1 }] },
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie },
      payload: { quoteId: quote.json().id, phone: '912345678' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie },
      payload: { quoteId: quote.json().id, phone: '912345678' },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('quote-already-used');
  });

  it('refuses a quote without a session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      payload: { items: [{ productId: event.products[0]?.id, qty: 1 }] },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('unauthorized');
  });

  it('enforces the alcohol limit per window (L8)', async () => {
    await resetDatabase(client);
    event = await seedEvent(client, { limits: { alcoholUnitsPerWindow: 2 } });
    const cookie = await join();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: event.products[0]?.id, qty: 2 }] },
    });
    expect(first.statusCode).toBe(201);

    await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie },
      payload: { quoteId: first.json().id, phone: '912345678' },
    });

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: event.products[0]?.id, qty: 1 }] },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('alcohol-limit-exceeded');
  });

  it('refuses purchases once sales are closed (spec 4.1)', async () => {
    const cookie = await join();
    await client.event.update({
      where: { id: event.eventId },
      data: { status: 'CLOSED_SALES' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: event.products[0]?.id, qty: 1 }] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('sales-closed');
  });

  it('sells at the base price while the emergency switch is on (spec 4.1)', async () => {
    const cookie = await join();
    const fino = event.products[0];

    await client.productEngineState.update({
      where: { productId: fino?.id ?? '' },
      data: { currentPriceCents: 240, rawPrice: 240 },
    });
    await client.event.update({ where: { id: event.eventId }, data: { fixedPrices: true } });

    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: fino?.id, qty: 1 }] },
    });

    expect(quote.json().items[0].unitPriceCents).toBe(fino?.basePriceCents);
  });
});
