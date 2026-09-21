import type { PrismaClient } from '@bolsa/db';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedEvent, sessionCookieFrom, type SeededEvent } from '../../test/app';
import { describeWithDatabase, resetDatabase, testPrismaClient } from '../../test/database';
import { RetentionService } from './retention.service';

const DAY = 86_400_000;

/**
 * L7 and spec 12.2: personal data goes after the retention window; the money
 * stays for as long as the tax authority says it must.
 */
describeWithDatabase('data retention', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  let retention: RetentionService;
  let event: SeededEvent;

  beforeAll(async () => {
    client = testPrismaClient();
    app = await createTestApp();
    retention = app.get(RetentionService);
  });

  afterAll(async () => {
    await app.close();
    await client.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(client);
    event = await seedEvent(client, {
      products: [{ name: 'Fino', basePriceCents: 150, stock: 100 }],
    });
  });

  /** A participant who bought, paid and gave a phone number. */
  async function buyAndPay(nickname: string): Promise<string> {
    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.eventId}/join`,
      payload: { nickname, isAdult: true, leaderboardOptIn: true, teamCode: 'ALFA' },
    });
    const cookie = sessionCookieFrom(joined.headers as Record<string, unknown>);

    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: event.products[0]?.id, qty: 2 }] },
    });
    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie },
      payload: { quoteId: quote.json().id, phone: '912345678', nif: '501442600' },
    });
    const payment = await client.payment.findFirstOrThrow({
      where: { orderId: order.json().id },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/dev/payments/${payment.providerRef}/PAID`,
      payload: {},
    });

    return order.json().id as string;
  }

  /** Finishes the event and backdates its end, so the window has passed. */
  async function finish(daysAgo: number): Promise<void> {
    await client.event.update({
      where: { id: event.eventId },
      data: { status: 'FINISHED', endsAt: new Date(Date.now() - daysAgo * DAY) },
    });
  }

  it('leaves a live event alone, however old its participants are', async () => {
    await buyAndPay('Ana');

    expect(await retention.anonymizeExpired()).toBe(0);

    const participant = await client.participant.findFirstOrThrow();
    expect(participant.nickname).toBe('Ana');
  });

  it('waits for the retention window to pass', async () => {
    await buyAndPay('Ana');
    await finish(10);

    expect(await retention.anonymizeExpired()).toBe(0);
  });

  it('removes the personal data once the window has passed', async () => {
    await buyAndPay('Ana');
    await finish(31);

    expect(await retention.anonymizeExpired()).toBe(1);

    const participant = await client.participant.findFirstOrThrow();
    expect(participant.nickname).not.toBe('Ana');
    expect(participant.phoneHash).toBeNull();
    expect(participant.teamCode).toBeNull();
    expect(participant.leaderboardOptIn).toBe(false);
    expect(participant.anonymizedAt).not.toBeNull();
  });

  it('keeps the money and the fiscal record intact (spec 12.2)', async () => {
    const orderId = await buyAndPay('Ana');
    await finish(31);
    await retention.anonymizeExpired();

    const order = await client.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    expect(order.totalCents).toBe(300);
    expect(order.nif).toBe('501442600');
    expect(order.items).toHaveLength(1);

    // The invoice owed for it is still there too.
    expect(await client.invoice.count({ where: { orderId } })).toBe(1);
  });

  it('invalidates the old session, because it was a credential', async () => {
    await buyAndPay('Ana');
    const before = await client.participant.findFirstOrThrow();
    await finish(31);
    await retention.anonymizeExpired();

    const after = await client.participant.findFirstOrThrow();
    expect(after.sessionId).not.toBe(before.sessionId);

    const reused = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `bb_session=${before.sessionId}` },
    });
    expect(reused.statusCode).toBe(401);
  });

  it('is safe to run twice', async () => {
    await buyAndPay('Ana');
    await finish(31);

    expect(await retention.anonymizeExpired()).toBe(1);
    expect(await retention.anonymizeExpired()).toBe(0);
  });

  it('gives unique placeholders to every participant', async () => {
    await buyAndPay('Ana');
    await buyAndPay('Bruno');
    await buyAndPay('Carla');
    await finish(31);

    expect(await retention.anonymizeExpired()).toBe(3);

    const nicknames = (await client.participant.findMany()).map((p) => p.nickname);
    expect(new Set(nicknames).size).toBe(3);
  });

  it('records the erasure in the audit log', async () => {
    await buyAndPay('Ana');
    await finish(31);
    await retention.anonymizeExpired();

    const entries = await client.auditLog.findMany({
      where: { action: 'participants.anonymized' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actorType).toBe('SYSTEM');
  });

  it('reports when the data is due to go', async () => {
    await buyAndPay('Ana');

    expect(await retention.status(event.eventId)).toMatchObject({
      retentionDays: 30,
      anonymizeAfter: null,
      pending: 1,
      anonymized: 0,
    });

    await finish(31);
    await retention.anonymizeExpired();

    expect(await retention.status(event.eventId)).toMatchObject({ pending: 0, anonymized: 1 });
  });
});
