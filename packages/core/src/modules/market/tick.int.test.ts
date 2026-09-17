import type { PrismaClient } from '@bolsa/db';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedEvent, sessionCookieFrom, type SeededEvent } from '../../test/app';
import { describeWithDatabase, resetDatabase, testPrismaClient } from '../../test/database';
import { TickService } from './tick.service';

/**
 * F2 acceptance: the tick worker turns confirmed sales into new prices.
 * The engine itself is proven pure in packages/pricing-engine; what is under
 * test here is everything around it: which sales count, what gets written, and
 * what happens when it runs twice.
 */
describeWithDatabase('market tick', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  let ticks: TickService;
  let event: SeededEvent;

  beforeAll(async () => {
    client = testPrismaClient();
    app = await createTestApp();
    ticks = app.get(TickService);
  });

  afterAll(async () => {
    await app.close();
    await client.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(client);
    event = await seedEvent(client, {
      products: [
        { name: 'Fino', basePriceCents: 150, stock: 500 },
        { name: 'Imperial', basePriceCents: 150, stock: 500 },
        { name: 'Cidra', basePriceCents: 150, stock: 500 },
      ],
      limits: { alcoholUnitsPerWindow: 50, maxQtyPerProduct: 10 },
    });
  });

  /** Buys and pays for `qty` of a product, so the sale counts for the engine. */
  async function buyAndPay(nickname: string, productId: string, qty: number): Promise<void> {
    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.eventId}/join`,
      payload: { nickname, isAdult: true },
    });
    const cookie = sessionCookieFrom(joined.headers as Record<string, unknown>);

    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId, qty }] },
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
      url: `/api/v1/dev/payments/${payment.providerRef}/PAID`,
      payload: {},
    });
  }

  it('advances the tick and records the price history', async () => {
    const result = await ticks.runFor(event.eventId);

    expect(result.tick).toBe(1);
    expect(result.skipped).toBeUndefined();

    const recorded = await client.priceTick.findMany({ where: { eventId: event.eventId } });
    expect(recorded).toHaveLength(3);
    expect(recorded[0]?.explain).toMatchObject({
      x: expect.any(Number),
      delta: expect.any(Number),
    });

    const updated = await client.event.findUniqueOrThrow({ where: { id: event.eventId } });
    expect(updated.currentTick).toBe(1);
    expect(updated.lastTickAt).not.toBeNull();
  });

  it('raises a drink that sells above its share and lowers its substitutes', async () => {
    const [fino, imperial, cidra] = event.products;
    // 50/27/23 against an expected 33/33/33. Deliberately not more lopsided
    // than that: with demand fully concentrated, renormalisation pins the
    // winner to its base price instead (see packages/pricing-engine tests).
    await buyAndPay('ana', fino?.id ?? '', 10);
    await buyAndPay('bruno', fino?.id ?? '', 5);
    await buyAndPay('carla', imperial?.id ?? '', 8);
    await buyAndPay('diogo', cidra?.id ?? '', 7);

    await ticks.runFor(event.eventId);

    const states = await client.productEngineState.findMany();
    const priceOf = (id: string) =>
      states.find((state) => state.productId === id)?.currentPriceCents ?? 0;

    expect(priceOf(fino?.id ?? '')).toBeGreaterThan(150);
    expect(priceOf(cidra?.id ?? '')).toBeLessThan(150);

    const finoTick = await client.priceTick.findFirstOrThrow({
      where: { productId: fino?.id, tick: 1 },
    });
    expect(finoTick.paidUnits).toBe(15);
  });

  it('ignores sales that were never paid (spec 5.1)', async () => {
    const fino = event.products[0];

    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.eventId}/join`,
      payload: { nickname: 'elsa', isAdult: true },
    });
    const cookie = sessionCookieFrom(joined.headers as Record<string, unknown>);
    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: fino?.id, qty: 10 }] },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie },
      payload: { quoteId: quote.json().id, phone: '912345678' },
    });

    await ticks.runFor(event.eventId);

    const finoTick = await client.priceTick.findFirstOrThrow({
      where: { productId: fino?.id, tick: 1 },
    });
    expect(finoTick.paidUnits).toBe(0);
    expect(finoTick.priceCents).toBe(150);
  });

  it('counts each sale for exactly one tick', async () => {
    const fino = event.products[0];
    await buyAndPay('ana', fino?.id ?? '', 10);

    await ticks.runFor(event.eventId);
    await ticks.runFor(event.eventId);

    const first = await client.priceTick.findFirstOrThrow({
      where: { productId: fino?.id, tick: 1 },
    });
    const second = await client.priceTick.findFirstOrThrow({
      where: { productId: fino?.id, tick: 2 },
    });

    expect(first.paidUnits).toBe(10);
    expect(second.paidUnits).toBe(0);
  });

  it('does not tick a paused market or one on fixed prices (spec 4.1)', async () => {
    await client.event.update({ where: { id: event.eventId }, data: { status: 'PAUSED' } });
    expect((await ticks.runFor(event.eventId)).skipped).toBe('not-open');

    await client.event.update({
      where: { id: event.eventId },
      data: { status: 'OPEN', fixedPrices: true },
    });
    expect((await ticks.runFor(event.eventId)).skipped).toBe('fixed-prices');

    expect(await client.priceTick.count({ where: { eventId: event.eventId } })).toBe(0);
  });

  it('freezes a sold-out product and leaves it out of its group', async () => {
    const fino = event.products[0];
    await client.product.update({
      where: { id: fino?.id ?? '' },
      data: { stockAvailable: 0 },
    });
    await client.productEngineState.update({
      where: { productId: fino?.id ?? '' },
      data: { currentPriceCents: 210, rawPrice: 210 },
    });

    await ticks.runFor(event.eventId);

    const state = await client.productEngineState.findUniqueOrThrow({
      where: { productId: fino?.id ?? '' },
    });
    expect(state.currentPriceCents).toBe(210);
  });

  it('lets only one of two concurrent ticks through', async () => {
    const results = await Promise.allSettled([
      ticks.runFor(event.eventId),
      ticks.runFor(event.eventId),
    ]);

    const succeeded = results.filter((result) => result.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);

    const updated = await client.event.findUniqueOrThrow({ where: { id: event.eventId } });
    expect(updated.currentTick).toBe(1);
    expect(await client.priceTick.count({ where: { eventId: event.eventId } })).toBe(3);
  });

  it('clears an expired manual override (spec 4.7)', async () => {
    const fino = event.products[0];
    await client.productEngineState.update({
      where: { productId: fino?.id ?? '' },
      data: { overridePriceCents: 220, overrideUntilTick: 1 },
    });

    await ticks.runFor(event.eventId);
    const pinned = await client.productEngineState.findUniqueOrThrow({
      where: { productId: fino?.id ?? '' },
    });
    expect(pinned.currentPriceCents).toBe(220);
    expect(pinned.overrideUntilTick).toBe(1);

    await ticks.runFor(event.eventId);
    const freed = await client.productEngineState.findUniqueOrThrow({
      where: { productId: fino?.id ?? '' },
    });
    expect(freed.overridePriceCents).toBeNull();
    expect(freed.overrideUntilTick).toBeNull();
  });
});
