import type { PrismaClient } from '@bolsa/db';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedEvent, sessionCookieFrom, type SeededEvent } from '../../test/app';
import { describeWithDatabase, resetDatabase, testPrismaClient } from '../../test/database';
import { AuthService } from '../auth/auth.service';

/**
 * The till, end to end: a customer who never opened the application still has
 * to move the same stock, get the same voucher and leave the same fiscal
 * document behind as one who paid with their phone.
 */
describeWithDatabase('counter sales', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  let event: SeededEvent;
  let cashierCookie: string;
  let staffCookie: string;

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
      products: [
        { name: 'Fino', basePriceCents: 150, stock: 100, isAlcoholic: true },
        { name: 'Agua', basePriceCents: 100, stock: 100, isAlcoholic: false },
      ],
      limits: { maxQtyPerProduct: 4 },
    });

    const auth = app.get(AuthService);
    await auth.createUser({
      eventId: event.eventId,
      email: 'caixa@festa.pt',
      password: 'password-do-caixa',
      role: 'CASHIER',
    });
    await auth.createUser({
      eventId: event.eventId,
      email: 'bar@festa.pt',
      password: 'password-do-bar',
      role: 'STAFF',
      pickupPoint: 'Bar principal',
    });

    cashierCookie = await login('caixa@festa.pt', 'password-do-caixa');
    staffCookie = await login('bar@festa.pt', 'password-do-bar');
  });

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { eventId: event.eventId, email, password },
    });
    expect(response.statusCode).toBe(201);
    return sessionCookieFrom(response.headers as Record<string, unknown>, 'bb_staff');
  }

  function quote(
    payload: Record<string, unknown>,
    cookie = cashierCookie,
  ): ReturnType<typeof app.inject> {
    return app.inject({
      method: 'POST',
      url: '/api/v1/counter/quotes',
      headers: { cookie },
      payload,
    });
  }

  function sell(
    payload: Record<string, unknown>,
    cookie = cashierCookie,
  ): ReturnType<typeof app.inject> {
    return app.inject({
      method: 'POST',
      url: '/api/v1/counter/sales',
      headers: { cookie },
      payload,
    });
  }

  it('takes cash, gives the change, and issues a voucher', async () => {
    const fino = event.products[0];

    const locked = await quote({ items: [{ productId: fino?.id, qty: 2 }], ageChecked: true });
    expect(locked.statusCode).toBe(201);
    expect(locked.json().totalCents).toBe(300);

    // L1: the price is locked before the notes are counted, same as the app.
    const afterQuote = await client.product.findUniqueOrThrow({ where: { id: fino?.id } });
    expect(afterQuote.stockReserved).toBe(2);
    expect(afterQuote.stockSold).toBe(0);

    const sale = await sell({
      quoteId: locked.json().id,
      method: 'CASH',
      cashReceivedCents: 1000,
    });

    expect(sale.statusCode).toBe(201);
    expect(sale.json()).toMatchObject({
      method: 'CASH',
      cashReceivedCents: 1000,
      changeCents: 700,
    });
    expect(sale.json().order.status).toBe('PAID');
    expect(sale.json().order.paymentMethod).toBe('CASH');
    expect(sale.json().order.voucher.shortCode).toHaveLength(6);

    // The sale commits stock exactly like a paid MB WAY order, so the engine
    // sees the same demand whichever way the money arrived.
    const afterSale = await client.product.findUniqueOrThrow({ where: { id: fino?.id } });
    expect(afterSale.stockReserved).toBe(0);
    expect(afterSale.stockSold).toBe(2);

    // L6: a sale at the till still owes a fiscal document.
    const invoice = await client.invoice.findUnique({
      where: { orderId: sale.json().order.id as string },
    });
    expect(invoice).not.toBeNull();
  });

  it('records the card terminal without asking for cash', async () => {
    const agua = event.products[1];

    const locked = await quote({ items: [{ productId: agua?.id, qty: 1 }] });
    const sale = await sell({ quoteId: locked.json().id, method: 'CARD_TERMINAL' });

    expect(sale.statusCode).toBe(201);
    expect(sale.json()).toMatchObject({
      method: 'CARD_TERMINAL',
      cashReceivedCents: null,
      changeCents: null,
    });

    const order = await client.order.findUniqueOrThrow({
      where: { id: sale.json().order.id as string },
    });
    expect(order.paymentMethod).toBe('CARD_TERMINAL');
    expect(order.cashReceivedCents).toBeNull();
  });

  it('names the cashier who rang it up', async () => {
    const locked = await quote({ items: [{ productId: event.products[1]?.id, qty: 1 }] });
    const sale = await sell({ quoteId: locked.json().id, method: 'CARD_TERMINAL' });

    const order = await client.order.findUniqueOrThrow({
      where: { id: sale.json().order.id as string },
      include: { soldBy: true },
    });
    expect(order.soldBy?.email).toBe('caixa@festa.pt');

    const audited = await client.auditLog.findFirst({ where: { action: 'counter.sale' } });
    expect(audited?.entityId).toBe(order.id);
  });

  it('refuses cash that does not cover the total', async () => {
    const locked = await quote({
      items: [{ productId: event.products[0]?.id, qty: 2 }],
      ageChecked: true,
    });
    expect(locked.json().totalCents).toBe(300);

    const sale = await sell({
      quoteId: locked.json().id,
      method: 'CASH',
      cashReceivedCents: 200,
    });

    expect(sale.statusCode).toBe(400);

    // Nothing was sold, and the drinks are still reserved for a second try.
    const product = await client.product.findUniqueOrThrow({
      where: { id: event.products[0]?.id },
    });
    expect(product.stockSold).toBe(0);
  });

  it('refuses alcohol until the cashier confirms the identification', async () => {
    // L5: the cashier has the customer in front of them, and the 18+ check is
    // refused before any stock is reserved.
    const locked = await quote({
      items: [{ productId: event.products[0]?.id, qty: 1 }],
      ageChecked: false,
    });

    expect(locked.statusCode).toBe(403);
    expect(locked.json().code).toBe('adult-declaration-required');

    const product = await client.product.findUniqueOrThrow({
      where: { id: event.products[0]?.id },
    });
    expect(product.stockReserved).toBe(0);
  });

  it('sells water without an identification check', async () => {
    const locked = await quote({
      items: [{ productId: event.products[1]?.id, qty: 1 }],
      ageChecked: false,
    });

    expect(locked.statusCode).toBe(201);
  });

  it('cannot take the same money twice', async () => {
    const locked = await quote({ items: [{ productId: event.products[1]?.id, qty: 1 }] });
    const payload = { quoteId: locked.json().id, method: 'CARD_TERMINAL' };

    const first = await sell(payload);
    const second = await sell(payload);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('quote-already-used');
  });

  it('names the field when the till sends something invalid', async () => {
    const sale = await sell({ method: 'CASH', cashReceivedCents: 500 });

    expect(sale.statusCode).toBe(400);
    expect(sale.json().meta.issues).toContainEqual({ path: 'quoteId', message: 'Required' });
  });

  it('is closed to an account that only hands drinks over', async () => {
    const locked = await quote(
      { items: [{ productId: event.products[1]?.id, qty: 1 }] },
      staffCookie,
    );

    expect(locked.statusCode).toBe(403);
  });

  it('will not settle a quote made on somebody phone', async () => {
    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.eventId}/join`,
      payload: { nickname: 'Ana', isAdult: true },
    });
    const cookie = sessionCookieFrom(joined.headers as Record<string, unknown>);

    const hers = await app.inject({
      method: 'POST',
      url: '/api/v1/quotes',
      headers: { cookie },
      payload: { items: [{ productId: event.products[1]?.id, qty: 1 }] },
    });
    expect(hers.statusCode).toBe(201);

    const sale = await sell({ quoteId: hers.json().id, method: 'CASH', cashReceivedCents: 500 });
    expect(sale.statusCode).toBe(404);
  });

  it('keeps the till out of the ranking', async () => {
    const locked = await quote({ items: [{ productId: event.products[1]?.id, qty: 4 }] });
    await sell({ quoteId: locked.json().id, method: 'CASH', cashReceivedCents: 1000 });

    const board = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.eventId}/leaderboard`,
    });

    expect(board.statusCode).toBe(200);
    // L4 and L7: a walk-up customer consented to nothing, so they are nobody's
    // competitor and appear on no screen.
    expect(board.json().entries).toEqual([]);
  });
});
