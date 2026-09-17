import type { PaymentStatus } from '@bolsa/shared';

/**
 * Spec 7: payments sit behind an interface so the gateway can be swapped
 * without touching the domain. The Mock implementation is what F2 runs on.
 */
export interface PaymentRequest {
  orderId: string;
  amountCents: number;
  /** MB WAY charges a Portuguese mobile number. */
  phone: string;
  description: string;
}

export interface PaymentResult {
  providerRef: string;
  status: PaymentStatus;
}

export interface PaymentWebhookEvent {
  providerRef: string;
  status: PaymentStatus;
  raw: unknown;
}

export abstract class PaymentProvider {
  abstract readonly name: string;

  /** Starts a payment. Returns PENDING for gateways that confirm out of band. */
  abstract charge(request: PaymentRequest): Promise<PaymentResult>;

  /**
   * Spec 6.1: the fallback when the webhook never arrives. A job polls this
   * until the payment resolves or the order times out.
   */
  abstract getStatus(providerRef: string): Promise<PaymentStatus>;

  /**
   * Verifies the gateway's signature and returns the event.
   * Spec 12.1: an unverified webhook is a forged webhook.
   */
  abstract verifyWebhook(headers: Record<string, unknown>, rawBody: string): PaymentWebhookEvent;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
