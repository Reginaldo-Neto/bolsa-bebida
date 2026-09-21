import type { PrismaClient } from '@bolsa/db';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedEvent, sessionCookieFrom, type SeededEvent } from '../../test/app';
import { describeWithDatabase, resetDatabase, testPrismaClient } from '../../test/database';

/**
 * Spec 4.6 and L4: the ranking measures how well someone bought, and must never
 * reward how much they drank.
 */
describeWithDatabase('leaderboard', () => {
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
    event = await seedEvent(client, {
      products: [{ name: 'Fino', basePriceCents: 200, stock: 500 }],
      // 50 is the highest the schema allows (L8); the test only needs enough
      // room for a handful of participants to buy ten each.
      limits: { maxQtyPerProduct: 10, alcoholUnitsPerWindow: 50 },
    });
  });

  /**
   * Buys `qty` units at `priceCents` by moving the quote price first, so the
   * saving against the base price is exactly what the test intends.
   */
  async function buyAt(
    nickname: string,
    priceCents: number,
    qty: number,
    options: { optIn?: boolean; teamCode?: string } = {},
  ): Promise<string> {
    await client.productEngineState.update({
      where: { productId: event.products[0]?.id ?? '' },
      data: { currentPriceCents: priceCents, rawPrice: priceCents },
    });

    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.eventId}/join`,
      payload: {
        nickname,
        isAdult: true,
        leaderboardOptIn: options.optIn ?? true,
        ...(options.teamCode ? { teamCode: options.teamCode } : {}),
      },
    });
    const cookie = sessionCookieFrom(joined.headers as Record<string, unknown>);

    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: event.products[0]?.id, qty }] },
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

    return cookie;
  }

  const board = (cookie?: string) =>
    app.inject({
      method: 'GET',
      url: cookie ? '/api/v1/leaderboard' : `/api/v1/events/${event.eventId}/leaderboard`,
      ...(cookie ? { headers: { cookie } } : {}),
    });

  it('ranks by how far below the base price someone bought', async () => {
    // Base is 200. Ana bought at 140 (30% off base), Bruno at 180 (10%).
    await buyAt('Ana', 140, 2);
    await buyAt('Bruno', 180, 2);

    const entries = (await board()).json().entries;

    expect(entries.map((entry: { nickname: string }) => entry.nickname)).toEqual(['Ana', 'Bruno']);
    expect(entries[0]).toMatchObject({ position: 1, points: 300 });
    expect(entries[1]).toMatchObject({ position: 2, points: 100 });
  });

  it('gives a buyer of ten no advantage over a buyer of two at the same price (L4)', async () => {
    await buyAt('Moderada', 140, 2);
    await buyAt('Sedenta', 140, 10);

    const entries = (await board()).json().entries;
    const points = entries.map((entry: { points: number }) => entry.points);

    expect(points[0]).toBe(points[1]);
  });

  it('never shows how much was bought or spent (L4)', async () => {
    await buyAt('Ana', 140, 3);

    const entry = (await board()).json().entries[0];

    expect(Object.keys(entry).sort()).toEqual([
      'nickname',
      'participantId',
      'points',
      'position',
      'teamCode',
    ]);
  });

  it('leaves out anyone who did not opt in (L7)', async () => {
    await buyAt('Publica', 140, 2, { optIn: true });
    await buyAt('Reservada', 100, 2, { optIn: false });

    const entries = (await board()).json().entries;

    // Reservada bought better but asked not to appear.
    expect(entries.map((entry: { nickname: string }) => entry.nickname)).toEqual(['Publica']);
  });

  it('shows a private participant their own score without listing them', async () => {
    const cookie = await buyAt('Reservada', 100, 2, { optIn: false });

    const view = (await board(cookie)).json();

    expect(view.entries).toHaveLength(0);
    expect(view.me).toMatchObject({ nickname: 'Reservada', optedIn: false, points: 500 });
  });

  it('needs at least two units before anyone is ranked (spec 4.6)', async () => {
    await buyAt('Curiosa', 140, 1);

    expect((await board()).json().entries).toHaveLength(0);
  });

  it('lets a participant leave and rejoin the ranking', async () => {
    const cookie = await buyAt('Ana', 140, 2);
    expect((await board()).json().entries).toHaveLength(1);

    await app.inject({
      method: 'POST',
      url: '/api/v1/me/leaderboard',
      headers: { cookie },
      payload: { optIn: false },
    });
    expect((await board()).json().entries).toHaveLength(0);

    await app.inject({
      method: 'POST',
      url: '/api/v1/me/leaderboard',
      headers: { cookie },
      payload: { optIn: true },
    });
    expect((await board()).json().entries).toHaveLength(1);
  });

  it('ranks teams on the average, so a big team does not win by being big (L4)', async () => {
    await buyAt('Ana', 140, 2, { teamCode: 'ALFA' });
    await buyAt('Bruno', 140, 2, { teamCode: 'BETA' });
    await buyAt('Carla', 180, 2, { teamCode: 'BETA' });
    await buyAt('Diogo', 180, 2, { teamCode: 'BETA' });

    const teams = (await board()).json().teams;

    // ALFA averages 300 with one member; BETA averages under that with three.
    expect(teams[0]).toMatchObject({ teamCode: 'ALFA', position: 1, members: 1 });
    expect(teams[1].points).toBeLessThan(teams[0].points);
    expect(teams[1].members).toBe(3);
  });

  it('counts nothing from an order that was never paid', async () => {
    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.eventId}/join`,
      payload: { nickname: 'Pendente', isAdult: true, leaderboardOptIn: true },
    });
    const cookie = sessionCookieFrom(joined.headers as Record<string, unknown>);
    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: event.products[0]?.id, qty: 4 }] },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie },
      payload: { quoteId: quote.json().id, phone: '912345678' },
    });

    expect((await board()).json().entries).toHaveLength(0);
  });
});
