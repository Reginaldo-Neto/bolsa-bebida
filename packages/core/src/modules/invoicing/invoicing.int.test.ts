import type { PrismaClient } from '@bolsa/db';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestApp, seedEvent, sessionCookieFrom, type SeededEvent } from '../../test/app';
import { describeWithDatabase, resetDatabase, testPrismaClient } from '../../test/database';
import { INVOICING_PROVIDER, type InvoicingProvider } from './invoicing-provider';
import { InvoicingService } from './invoicing.service';

/**
 * L6 (Portaria 363/2010): every payment produces a fiscal document. What is
 * under test is that the obligation is recorded with the payment and survives
 * the tax API being down, which it will be at some point during the night.
 */
describeWithDatabase('invoicing', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  let invoicing: InvoicingService;
  let provider: InvoicingProvider;
  let event: SeededEvent;

  beforeAll(async () => {
    client = testPrismaClient();
    app = await createTestApp();
    invoicing = app.get(InvoicingService);
    provider = app.get(INVOICING_PROVIDER);
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
    vi.restoreAllMocks();
  });

  /** Buys and pays, returning the order id. */
  async function buyAndPay(nickname: string, nif?: string): Promise<string> {
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
      payload: { items: [{ productId: event.products[0]?.id, qty: 2 }] },
    });
    const order = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie },
      payload: { quoteId: quote.json().id, phone: '912345678', ...(nif ? { nif } : {}) },
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

  it('records the obligation the moment the payment is confirmed', async () => {
    const orderId = await buyAndPay('Ana');

    const invoice = await client.invoice.findUniqueOrThrow({ where: { orderId } });
    expect(invoice.status).toBe('PENDING');
    expect(invoice.attempts).toBe(0);
  });

  it('owes nothing for an order that was never paid', async () => {
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
    await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie },
      payload: { quoteId: quote.json().id, phone: '912345678' },
    });

    expect(await client.invoice.count()).toBe(0);
  });

  it('issues the document and records its number', async () => {
    const orderId = await buyAndPay('Carla');

    const result = await invoicing.processPending();
    expect(result).toEqual({ issued: 1, failed: 0 });

    const invoice = await client.invoice.findUniqueOrThrow({ where: { orderId } });
    expect(invoice.status).toBe('ISSUED');
    expect(invoice.documentNumber).toMatch(/^MOCK\//);
  });

  it('sends the lines with the price charged and the VAT rate of each drink', async () => {
    await buyAndPay('Diogo', '501442600');
    const issue = vi.spyOn(provider, 'issue');

    await invoicing.processPending();

    expect(issue).toHaveBeenCalledOnce();
    const request = issue.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      customerNif: '501442600',
      customerName: 'Diogo',
      totalCents: 300,
    });
    expect(request?.lines[0]).toMatchObject({
      description: 'Fino',
      quantity: 2,
      unitPriceCents: 150,
      // Alcoholic drinks default to the standard rate.
      vatBasisPoints: 2300,
    });
  });

  it('sends no NIF when the participant did not give one (L6)', async () => {
    await buyAndPay('Eva');
    const issue = vi.spyOn(provider, 'issue');

    await invoicing.processPending();

    expect(issue.mock.calls[0]?.[0].customerNif).toBeNull();
  });

  it('issues each document exactly once, however often the job runs', async () => {
    await buyAndPay('Filipa');
    const issue = vi.spyOn(provider, 'issue');

    await invoicing.processPending();
    await invoicing.processPending();
    await invoicing.processPending();

    expect(issue).toHaveBeenCalledOnce();
  });

  it('keeps the document owed when the tax API is down, and issues it later', async () => {
    const orderId = await buyAndPay('Gonçalo');

    const failing = vi
      .spyOn(provider, 'issue')
      .mockRejectedValueOnce(new Error('gateway fiscal indisponivel'));

    expect(await invoicing.processPending()).toEqual({ issued: 0, failed: 1 });

    const afterFailure = await client.invoice.findUniqueOrThrow({ where: { orderId } });
    expect(afterFailure.status).toBe('PENDING');
    expect(afterFailure.attempts).toBe(1);
    expect(afterFailure.lastError).toContain('indisponivel');

    failing.mockRestore();
    expect(await invoicing.processPending()).toEqual({ issued: 1, failed: 0 });

    const afterRetry = await client.invoice.findUniqueOrThrow({ where: { orderId } });
    expect(afterRetry.status).toBe('ISSUED');
    expect(afterRetry.lastError).toBeNull();
  });

  it('gives up only after repeated failures, and says so', async () => {
    const orderId = await buyAndPay('Helena');
    vi.spyOn(provider, 'issue').mockRejectedValue(new Error('recusado'));

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await invoicing.processPending();
    }

    const invoice = await client.invoice.findUniqueOrThrow({ where: { orderId } });
    expect(invoice.status).toBe('FAILED');
    expect(invoice.attempts).toBe(8);

    // Spec 13.3: the admin panel needs to be able to raise the alarm.
    expect(await invoicing.health(event.eventId)).toEqual({ pending: 0, failed: 1 });
  });
});
