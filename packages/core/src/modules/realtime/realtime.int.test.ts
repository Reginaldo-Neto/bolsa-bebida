import type { PrismaClient } from '@bolsa/db';
import { REALTIME_CHANNEL, eventRoom, participantRoom, type RealtimeMessage } from '@bolsa/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedEvent, sessionCookieFrom, type SeededEvent } from '../../test/app';
import { describeWithDatabase, resetDatabase, testPrismaClient } from '../../test/database';
import type { FakeRedisConnections } from '../../test/fake-redis';
import { TickService } from '../market/tick.service';
import { RedisConnections } from './redis.provider';

/**
 * Spec 10.2: what the phones are told, and who is allowed to hear it.
 * The transport is a fake here; what is under test is the routing.
 */
describeWithDatabase('realtime events', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  let redis: FakeRedisConnections;
  let event: SeededEvent;

  beforeAll(async () => {
    client = testPrismaClient();
    app = await createTestApp();
    redis = app.get(RedisConnections) as unknown as FakeRedisConnections;
  });

  afterAll(async () => {
    await app.close();
    await client.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(client);
    redis.publisher.published.length = 0;
    event = await seedEvent(client);
  });

  function messages(): RealtimeMessage[] {
    return redis.publisher.published
      .filter((entry) => entry.channel === REALTIME_CHANNEL)
      .map((entry) => JSON.parse(entry.message) as RealtimeMessage);
  }

  it('announces a tick to the event room with the published range intact', async () => {
    await app.get(TickService).runFor(event.eventId);

    const tick = messages().find((message) => message.event === 'market.tick');
    expect(tick).toBeDefined();
    expect(tick?.room).toBe(eventRoom(event.eventId));

    const payload = tick?.payload as {
      tick: number;
      products: { id: string; priceCents: number; stockStatus: string }[];
    };
    expect(payload.tick).toBe(1);
    expect(payload.products).toHaveLength(2);
    expect(payload.products[0]?.stockStatus).toBe('IN_STOCK');
  });

  it('tells a participant when their own order is paid, and nobody else', async () => {
    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.eventId}/join`,
      payload: { nickname: 'Ana', isAdult: true },
    });
    const cookie = sessionCookieFrom(joined.headers as Record<string, unknown>);
    const participant = await client.participant.findFirstOrThrow();

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

    redis.publisher.published.length = 0;
    await app.inject({
      method: 'POST',
      url: `/api/v1/dev/payments/${payment.providerRef}/PAID`,
      payload: {},
    });

    const updates = messages().filter((message) => message.event === 'order.updated');
    expect(updates).toHaveLength(1);
    // A private room: an order status is nobody else's business.
    expect(updates[0]?.room).toBe(participantRoom(participant.id));
    expect(updates[0]?.payload).toMatchObject({
      orderId: order.json().id,
      status: 'PAID',
    });
  });

  it('says nothing when a webhook is replayed', async () => {
    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.eventId}/join`,
      payload: { nickname: 'Bruno', isAdult: true },
    });
    const cookie = sessionCookieFrom(joined.headers as Record<string, unknown>);

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

    await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments/mock',
      payload: { providerRef: payment.providerRef, status: 'PAID' },
    });
    redis.publisher.published.length = 0;
    await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments/mock',
      payload: { providerRef: payment.providerRef, status: 'PAID' },
    });

    expect(messages().filter((message) => message.event === 'order.updated')).toHaveLength(0);
  });

  it('announces a product that has just sold out', async () => {
    await seedEvent(client);
    const soldOut = await client.product.findFirstOrThrow({ where: { eventId: event.eventId } });
    await client.product.update({
      where: { id: soldOut.id },
      data: { stockAvailable: 0 },
    });

    await app.get(TickService).runFor(event.eventId);

    const announcement = messages().find((message) => message.event === 'product.soldout');
    expect(announcement?.room).toBe(eventRoom(event.eventId));
    expect(announcement?.payload).toMatchObject({ productId: soldOut.id });
  });
});
