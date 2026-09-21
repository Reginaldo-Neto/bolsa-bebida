import type { PrismaClient } from '@bolsa/db';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TOTP } from 'otpauth';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedEvent, sessionCookieFrom, type SeededEvent } from '../../test/app';
import { describeWithDatabase, resetDatabase, testPrismaClient } from '../../test/database';
import { AuthService } from '../auth/auth.service';
import { TickService } from '../market/tick.service';

/**
 * F4 acceptance: the organiser can pause and resume the market, and everything
 * they do leaves a trace.
 */
describeWithDatabase('admin panel', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  let event: SeededEvent;
  let adminCookie: string;
  let totpSecret: string;

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
        { name: 'Fino', basePriceCents: 150, stock: 100 },
        { name: 'Cidra', basePriceCents: 200, stock: 100 },
      ],
    });

    const created = await app.get(AuthService).createUser({
      eventId: event.eventId,
      email: 'admin@festa.pt',
      password: 'password-do-admin',
      role: 'ADMIN',
    });
    totpSecret = created.totpSecret ?? '';

    adminCookie = await login();
  });

  async function login(code = new TOTP({ secret: totpSecret }).generate()): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        eventId: event.eventId,
        email: 'admin@festa.pt',
        password: 'password-do-admin',
        totp: code,
      },
    });
    expect(response.statusCode).toBe(201);
    return sessionCookieFrom(response.headers as Record<string, unknown>, 'bb_staff');
  }

  const post = (url: string, payload: unknown) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie: adminCookie }, payload });

  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie: adminCookie } });

  it('requires a TOTP code from an administrator (spec 3)', async () => {
    const withoutCode = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        eventId: event.eventId,
        email: 'admin@festa.pt',
        password: 'password-do-admin',
      },
    });
    expect(withoutCode.statusCode).toBe(401);

    const wrongCode = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        eventId: event.eventId,
        email: 'admin@festa.pt',
        password: 'password-do-admin',
        totp: '000000',
      },
    });
    expect(wrongCode.statusCode).toBe(401);
  });

  it('answers the same way to a wrong password and an unknown account', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { eventId: event.eventId, email: 'admin@festa.pt', password: 'errada' },
    });
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { eventId: event.eventId, email: 'ninguem@festa.pt', password: 'errada' },
    });

    expect(wrongPassword.statusCode).toBe(unknownEmail.statusCode);
    expect(wrongPassword.json().detail).toBe(unknownEmail.json().detail);
  });

  it('pauses and resumes the market', async () => {
    const paused = await post('/admin/events/state', { action: 'PAUSED' });
    expect(paused.json()).toMatchObject({ status: 'PAUSED' });

    // Spec 4.1: purchases still work while paused, prices simply stop moving.
    expect((await app.get(TickService).runFor(event.eventId)).skipped).toBe('not-open');

    const resumed = await post('/admin/events/state', { action: 'OPEN' });
    expect(resumed.json()).toMatchObject({ status: 'OPEN' });
    expect((await app.get(TickService).runFor(event.eventId)).skipped).toBeUndefined();
  });

  it('refuses a transition the lifecycle does not allow', async () => {
    await post('/admin/events/state', { action: 'CLOSED_SALES' });
    const reopen = await post('/admin/events/state', { action: 'OPEN' });

    expect(reopen.statusCode).toBe(400);
    expect(reopen.json().code).toBe('validation-failed');
  });

  it('sends every quote back to its base price when prices are fixed (spec 4.1)', async () => {
    const fino = event.products[0];
    await client.productEngineState.update({
      where: { productId: fino?.id ?? '' },
      data: {
        currentPriceCents: 240,
        rawPrice: 240,
        overridePriceCents: 240,
        overrideUntilTick: 9,
      },
    });

    const response = await post('/admin/events/state', { action: 'FIXED_PRICES' });
    expect(response.json()).toMatchObject({ fixedPrices: true });

    const state = await client.productEngineState.findUniqueOrThrow({
      where: { productId: fino?.id ?? '' },
    });
    expect(state.currentPriceCents).toBe(150);
    expect(state.overridePriceCents).toBeNull();

    // And the engine stops until prices are released again.
    expect((await app.get(TickService).runFor(event.eventId)).skipped).toBe('fixed-prices');

    await post('/admin/events/state', { action: 'RESUME_PRICES' });
    expect((await app.get(TickService).runFor(event.eventId)).skipped).toBeUndefined();
  });

  it('pins a price inside the published range and refuses one outside it (L2)', async () => {
    const fino = event.products[0];

    const inside = await post(`/admin/products/${fino?.id}/override`, {
      priceCents: 200,
      ticks: 3,
    });
    expect(inside.json()).toMatchObject({ priceCents: 200 });

    const outside = await post(`/admin/products/${fino?.id}/override`, {
      priceCents: 9999,
      ticks: 3,
    });
    expect(outside.statusCode).toBe(400);
    expect(outside.json().code).toBe('price-out-of-range');
  });

  it('adjusts stock with a reason and writes it to the audit log (spec 4.2)', async () => {
    const fino = event.products[0];

    const added = await post(`/admin/products/${fino?.id}/stock-adjust`, {
      delta: 24,
      reason: 'Chegou mais um grade',
    });
    expect(added.json().stockAvailable).toBe(124);

    const tooMany = await post(`/admin/products/${fino?.id}/stock-adjust`, {
      delta: -1000,
      reason: 'Engano',
    });
    expect(tooMany.statusCode).toBe(409);

    const entries = await client.auditLog.findMany({ where: { action: 'product.stock_adjust' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.after).toMatchObject({ reason: 'Chegou mais um grade' });
  });

  it('exports the catalogue and imports it back', async () => {
    const exported = await get('/admin/products.csv');
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.body).toContain('Fino');

    const imported = await post('/admin/products.csv', {
      csv: exported.body.replace('Fino', 'Fino Mini'),
    });
    // Two lines in, two lines imported. The renamed one does not match an
    // existing product, so the catalogue ends up with three.
    expect(imported.json()).toMatchObject({ imported: 2, errors: [] });

    const products = await client.product.findMany({ where: { eventId: event.eventId } });
    expect(products.map((product) => product.name).sort()).toEqual(['Cidra', 'Fino', 'Fino Mini']);
  });

  it('imports nothing at all when a line is wrong', async () => {
    const csv =
      'nome,grupo,preco_base_centimos,preco_minimo_centimos,preco_maximo_centimos,stock_inicial\r\n' +
      'Bom,Cerveja,150,100,200,10\r\n' +
      'Mau,Cerveja,50,100,200,10\r\n';

    const response = await post('/admin/products.csv', { csv });

    expect(response.json().imported).toBe(0);
    expect(response.json().errors[0]).toContain('Linha 3');
    expect(await client.product.findFirst({ where: { name: 'Bom' } })).toBeNull();
  });

  it('produces every report as CSV', async () => {
    for (const type of ['vendas', 'precos', 'levantamentos', 'reembolsos']) {
      const response = await get(`/admin/reports/${type}.csv`);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-disposition']).toContain(`${type}.csv`);
    }

    expect((await get('/admin/reports/inventado.csv')).statusCode).toBe(404);
  });

  it('shows live revenue and stock on the dashboard', async () => {
    const dashboard = await get('/admin/dashboard');

    expect(dashboard.json()).toMatchObject({
      revenueCents: 0,
      unitsSold: 0,
      pendingOrders: 0,
    });
    expect(dashboard.json().products).toHaveLength(2);
  });
});
