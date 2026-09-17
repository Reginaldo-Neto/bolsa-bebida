import type { PrismaClient } from '@bolsa/db';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedEvent, sessionCookieFrom, type SeededEvent } from '../../test/app';
import { describeWithDatabase, resetDatabase, testPrismaClient } from '../../test/database';
import { AuthService } from '../auth/auth.service';

/**
 * F4 acceptance: a voucher cannot be redeemed twice, however many staff phones
 * scan it at the same moment.
 */
describeWithDatabase('voucher redemption', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  let event: SeededEvent;
  let staffCookie: string;
  let voucherId: string;
  let shortCode: string;
  let orderItemId: string;

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
      products: [{ name: 'Fino', basePriceCents: 150, stock: 100 }],
      limits: { maxQtyPerProduct: 4 },
    });

    await app.get(AuthService).createUser({
      eventId: event.eventId,
      email: 'bar@festa.pt',
      password: 'password-do-bar',
      role: 'STAFF',
      pickupPoint: 'Bar principal',
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { eventId: event.eventId, email: 'bar@festa.pt', password: 'password-do-bar' },
    });
    expect(login.statusCode).toBe(201);
    staffCookie = sessionCookieFrom(login.headers as Record<string, unknown>, 'bb_staff');

    // A participant buys two drinks and pays for them.
    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.eventId}/join`,
      payload: { nickname: 'Ana', isAdult: true },
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

    const voucher = await client.voucher.findFirstOrThrow({
      where: { orderId: order.json().id },
    });
    voucherId = voucher.id;
    shortCode = voucher.shortCode;
    orderItemId = order.json().items[0].id;
  });

  const scan = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/staff/vouchers/scan',
      headers: { cookie: staffCookie },
      payload,
    });

  const redeem = (qty: number) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/staff/vouchers/${voucherId}/redeem`,
      headers: { cookie: staffCookie },
      payload: { items: [{ orderItemId, qty }], ageChecked: true },
    });

  it('finds a voucher by short code and lists what is still owed', async () => {
    const response = await scan({ shortCode });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      shortCode,
      nickname: 'Ana',
      // L5: alcohol on the voucher means staff must check identification.
      requiresAgeCheck: true,
    });
    expect(response.json().items[0]).toMatchObject({ qty: 2, redeemedQty: 0, pendingQty: 2 });
  });

  it('finds the same voucher by its signed QR', async () => {
    const orders = await client.voucher.findFirstOrThrow({ where: { id: voucherId } });
    const qr = `BB1.${orders.id}.${orders.eventId}.${orders.signature}`;

    expect((await scan({ qr })).json()).toMatchObject({ voucherId });
  });

  it('refuses a QR with a broken signature', async () => {
    const voucher = await client.voucher.findFirstOrThrow({ where: { id: voucherId } });
    const response = await scan({ qr: `BB1.${voucher.id}.${voucher.eventId}.forjado` });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('voucher-invalid');
    // Spec 6.4: nothing internal leaks through the refusal.
    expect(response.json().detail).toBe('Voucher invalido.');
  });

  it('refuses a voucher from another event', async () => {
    const other = await seedEvent(client, {
      products: [{ name: 'Outro', basePriceCents: 100, stock: 1 }],
    });
    const voucher = await client.voucher.findFirstOrThrow({ where: { id: voucherId } });

    const response = await scan({ qr: `BB1.${voucher.id}.${other.eventId}.${voucher.signature}` });
    expect(response.json().code).toBe('voucher-invalid');
  });

  it('hands over part of the voucher and leaves the rest pending', async () => {
    const response = await redeem(1);

    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('PARTIALLY_REDEEMED');
    expect(response.json().items[0]).toMatchObject({ redeemedQty: 1, pendingQty: 1 });

    const order = await client.order.findFirstOrThrow();
    expect(order.status).toBe('PARTIALLY_REDEEMED');
  });

  it('never hands over more than was bought, however many scans race', async () => {
    const attempts = await Promise.all(Array.from({ length: 10 }, () => redeem(2)));

    const accepted = attempts.filter((attempt) => attempt.statusCode === 201);
    expect(accepted).toHaveLength(1);

    for (const refused of attempts.filter((attempt) => attempt.statusCode !== 201)) {
      expect(refused.json().code).toBe('voucher-already-redeemed');
    }

    const item = await client.orderItem.findUniqueOrThrow({ where: { id: orderItemId } });
    expect(item.redeemedQty).toBe(2);

    const redemptions = await client.redemption.findMany({ where: { voucherId } });
    expect(redemptions).toHaveLength(1);
  });

  it('marks the voucher redeemed once nothing is pending', async () => {
    await redeem(2);

    const voucher = await client.voucher.findUniqueOrThrow({ where: { id: voucherId } });
    expect(voucher.status).toBe('REDEEMED');

    const again = await redeem(1);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('voucher-already-redeemed');
  });

  it('refuses to hand over alcohol without the identification check (L5)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/vouchers/${voucherId}/redeem`,
      headers: { cookie: staffCookie },
      payload: { items: [{ orderItemId, qty: 1 }], ageChecked: false },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('adult-declaration-required');

    const item = await client.orderItem.findUniqueOrThrow({ where: { id: orderItemId } });
    expect(item.redeemedQty).toBe(0);
  });

  it('records who handed it over, where and when (spec 4.7)', async () => {
    await redeem(1);

    const redemption = await client.redemption.findFirstOrThrow({
      include: { staffUser: true },
    });
    expect(redemption.staffUser.email).toBe('bar@festa.pt');
    expect(redemption.pickupPoint).toBe('Bar principal');
    expect(redemption.ageChecked).toBe(true);

    const audit = await client.auditLog.findMany({ where: { action: 'voucher.redeem' } });
    expect(audit).toHaveLength(1);
  });

  it('refuses anyone without a staff session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/vouchers/scan',
      payload: { shortCode },
    });

    expect(response.statusCode).toBe(401);
  });

  it('refuses staff from reaching the admin panel', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dashboard',
      headers: { cookie: staffCookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('forbidden');
  });
});
