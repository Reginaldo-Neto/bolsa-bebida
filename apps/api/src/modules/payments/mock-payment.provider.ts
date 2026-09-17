import { randomUUID } from 'node:crypto';
import { DomainError, type PaymentStatus } from '@bolsa/shared';
import { Injectable } from '@nestjs/common';
import type {
  PaymentProvider,
  PaymentRequest,
  PaymentResult,
  PaymentWebhookEvent,
} from './payment-provider';

/**
 * Development gateway. Payments stay PENDING until something calls
 * `simulateCallback`, which mirrors what the real gateway's webhook does, so
 * the confirmation path under test is the same one production will run.
 *
 * The env schema refuses to boot with this provider in production.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  private readonly payments = new Map<string, { status: PaymentStatus; amountCents: number }>();

  charge(request: PaymentRequest): Promise<PaymentResult> {
    const providerRef = `mock_${randomUUID()}`;
    this.payments.set(providerRef, { status: 'PENDING', amountCents: request.amountCents });
    return Promise.resolve({ providerRef, status: 'PENDING' });
  }

  getStatus(providerRef: string): Promise<PaymentStatus> {
    const payment = this.payments.get(providerRef);
    if (!payment) {
      throw new DomainError('not-found', 'Pagamento desconhecido no gateway.', { providerRef });
    }
    return Promise.resolve(payment.status);
  }

  verifyWebhook(_headers: Record<string, unknown>, rawBody: string): PaymentWebhookEvent {
    const parsed = JSON.parse(rawBody) as { providerRef?: string; status?: string };

    if (!parsed.providerRef || !parsed.status) {
      throw new DomainError('validation-failed', 'Webhook sem providerRef ou status.');
    }
    if (!isPaymentStatus(parsed.status)) {
      throw new DomainError('validation-failed', `Estado de pagamento invalido: ${parsed.status}`);
    }

    return { providerRef: parsed.providerRef, status: parsed.status, raw: parsed };
  }

  /** Test and development hook: behaves like the gateway confirming a payment. */
  simulateCallback(providerRef: string, status: PaymentStatus): PaymentWebhookEvent {
    const payment = this.payments.get(providerRef);
    if (!payment) {
      throw new DomainError('not-found', 'Pagamento desconhecido no gateway.', { providerRef });
    }

    this.payments.set(providerRef, { ...payment, status });
    return { providerRef, status, raw: { providerRef, status, simulated: true } };
  }
}

function isPaymentStatus(value: string): value is PaymentStatus {
  return value === 'PENDING' || value === 'PAID' || value === 'FAILED' || value === 'EXPIRED';
}
