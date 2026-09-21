import { createHmac } from 'node:crypto';
import { DomainError } from '@bolsa/shared';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env';
import { MbWayPaymentProvider } from './mbway-payment.provider';

const SECRET = 'segredo-de-webhook-de-teste';

function provider(): MbWayPaymentProvider {
  return new MbWayPaymentProvider(
    new ConfigService<Env, true>({
      MBWAY_API_BASE_URL: 'https://gateway.example.pt',
      MBWAY_API_KEY: 'chave',
      MBWAY_WEBHOOK_SECRET: SECRET,
    } as unknown as Env),
  );
}

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('MB WAY configuration', () => {
  it('refuses to start without its secrets', () => {
    expect(
      () => new MbWayPaymentProvider(new ConfigService<Env, true>({} as unknown as Env)),
    ).toThrow(/obrigatorios/);
  });
});

/**
 * Spec 12.1: an unverified webhook is a forged webhook, and a forged one hands
 * out free drinks. This is the sharpest edge in the payment path.
 */
describe('webhook signature', () => {
  const body = JSON.stringify({ id: 'pay_123', status: 'PAID' });

  it('accepts a correctly signed webhook', () => {
    const event = provider().verifyWebhook({ 'x-signature': sign(body) }, body);

    expect(event).toMatchObject({ providerRef: 'pay_123', status: 'PAID' });
  });

  it('accepts the sha256= prefix some gateways send', () => {
    const event = provider().verifyWebhook({ 'x-signature': `sha256=${sign(body)}` }, body);

    expect(event.status).toBe('PAID');
  });

  it('refuses a webhook with no signature at all', () => {
    expect(() => provider().verifyWebhook({}, body)).toThrow(DomainError);
    expect(() => provider().verifyWebhook({ 'x-signature': '' }, body)).toThrow(/assinatura/);
  });

  it('refuses a signature made with the wrong secret', () => {
    const forged = sign(body, 'segredo-errado');

    expect(() => provider().verifyWebhook({ 'x-signature': forged }, body)).toThrow(
      /Assinatura de webhook invalida/,
    );
  });

  it('refuses a body that was altered after signing', () => {
    const signature = sign(body);
    const tampered = JSON.stringify({ id: 'pay_123', status: 'PAID', amountCents: 1 });

    expect(() => provider().verifyWebhook({ 'x-signature': signature }, tampered)).toThrow(
      DomainError,
    );
  });

  it('refuses a truncated signature instead of comparing what fits', () => {
    const signature = sign(body).slice(0, 20);

    expect(() => provider().verifyWebhook({ 'x-signature': signature }, body)).toThrow(DomainError);
  });

  it('refuses a verified body with no payment reference', () => {
    const withoutRef = JSON.stringify({ status: 'PAID' });

    expect(() => provider().verifyWebhook({ 'x-signature': sign(withoutRef) }, withoutRef)).toThrow(
      /referencia/,
    );
  });
});

describe('gateway status mapping', () => {
  const cases: [string, string][] = [
    ['PAID', 'PAID'],
    ['success', 'PAID'],
    ['COMPLETED', 'PAID'],
    ['captured', 'PAID'],
    ['FAILED', 'FAILED'],
    ['declined', 'FAILED'],
    ['CANCELLED', 'FAILED'],
    ['EXPIRED', 'EXPIRED'],
    ['timeout', 'EXPIRED'],
    ['PENDING', 'PENDING'],
  ];

  it.each(cases)('reads %s as %s', (gatewayStatus, expected) => {
    const body = JSON.stringify({ id: 'pay_1', status: gatewayStatus });
    expect(provider().verifyWebhook({ 'x-signature': sign(body) }, body).status).toBe(expected);
  });

  it('treats a word it does not know as still pending', () => {
    // Guessing PAID would give away a drink; guessing FAILED would release
    // stock someone had already paid for. The polling job resolves it later.
    const body = JSON.stringify({ id: 'pay_1', status: 'EM_ANALISE' });

    expect(provider().verifyWebhook({ 'x-signature': sign(body) }, body).status).toBe('PENDING');
  });
});
