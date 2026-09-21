import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError, type PaymentStatus } from '@bolsa/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type {
  PaymentProvider,
  PaymentRequest,
  PaymentResult,
  PaymentWebhookEvent,
} from './payment-provider';

const TIMEOUT_MS = 12_000;

/**
 * MB WAY through a Portuguese payment gateway.
 *
 * Which gateway is still an open decision (spec 14.2), so the request and
 * response shapes below follow what these APIs have in common. Changing to the
 * chosen one means editing `charge`, `getStatus` and `readStatus`.
 *
 * What is not vendor-specific, and is the part that matters, is the webhook:
 * it is verified with an HMAC over the exact bytes received, compared in
 * constant time. An unverified webhook is a forged webhook (spec 12.1), and a
 * forged one hands out free drinks.
 */
@Injectable()
export class MbWayPaymentProvider implements PaymentProvider {
  readonly name = 'mbway';
  private readonly logger = new Logger(MbWayPaymentProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;

  constructor(config: ConfigService<Env, true>) {
    const baseUrl = config.get('MBWAY_API_BASE_URL', { infer: true });
    const apiKey = config.get('MBWAY_API_KEY', { infer: true });
    const webhookSecret = config.get('MBWAY_WEBHOOK_SECRET', { infer: true });

    if (!baseUrl || !apiKey || !webhookSecret) {
      throw new Error('MBWAY_API_BASE_URL, MBWAY_API_KEY e MBWAY_WEBHOOK_SECRET sao obrigatorios.');
    }

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.webhookSecret = webhookSecret;
  }

  async charge(request: PaymentRequest): Promise<PaymentResult> {
    const response = await fetch(`${this.baseUrl}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        // Our order id: a retried request must not charge twice.
        'Idempotency-Key': request.orderId,
      },
      body: JSON.stringify({
        method: 'MBWAY',
        amountCents: request.amountCents,
        currency: 'EUR',
        customerPhone: request.phone,
        description: request.description,
        reference: request.orderId,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `o gateway recusou o pedido de pagamento: ${response.status} (encomenda ${request.orderId})`,
      );
      throw new DomainError(
        'payment-failed',
        'Nao foi possivel iniciar o pagamento. Tente novamente.',
        { gatewayStatus: response.status, detail: detail.slice(0, 200) },
      );
    }

    const body = (await response.json()) as { id?: string; reference?: string; status?: string };
    const providerRef = body.id ?? body.reference;

    if (!providerRef) {
      throw new DomainError('payment-failed', 'O gateway nao devolveu uma referencia.');
    }

    return { providerRef, status: this.readStatus(body.status) };
  }

  async getStatus(providerRef: string): Promise<PaymentStatus> {
    const response = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(providerRef)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new DomainError('internal-error', `O gateway respondeu ${response.status}.`);
    }

    const body = (await response.json()) as { status?: string };
    return this.readStatus(body.status);
  }

  /**
   * Spec 12.1: the signature is computed over the raw body, before any parsing,
   * and compared in constant time so a timing difference cannot leak it.
   */
  verifyWebhook(headers: Record<string, unknown>, rawBody: string): PaymentWebhookEvent {
    const header = headers['x-signature'] ?? headers['x-webhook-signature'];
    const signature = Array.isArray(header) ? header[0] : header;

    if (typeof signature !== 'string' || signature.length === 0) {
      throw new DomainError('forbidden', 'Webhook sem assinatura.');
    }

    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const provided = signature.replace(/^sha256=/, '');

    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(provided, 'utf8');

    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      this.logger.warn('webhook com assinatura invalida recusado');
      throw new DomainError('forbidden', 'Assinatura de webhook invalida.');
    }

    const parsed = JSON.parse(rawBody) as { id?: string; reference?: string; status?: string };
    const providerRef = parsed.id ?? parsed.reference;

    if (!providerRef) {
      throw new DomainError('validation-failed', 'Webhook sem referencia de pagamento.');
    }

    return { providerRef, status: this.readStatus(parsed.status), raw: parsed };
  }

  /**
   * Anything the gateway calls by another name is treated as still pending:
   * guessing PAID from an unknown word would hand out a drink for free, while
   * guessing FAILED would release stock someone had already paid for. The
   * polling job resolves it on the next pass.
   */
  private readStatus(status: string | undefined): PaymentStatus {
    switch (status?.toUpperCase()) {
      case 'PAID':
      case 'SUCCESS':
      case 'COMPLETED':
      case 'CAPTURED':
        return 'PAID';
      case 'FAILED':
      case 'DECLINED':
      case 'REJECTED':
      case 'CANCELLED':
      case 'CANCELED':
        return 'FAILED';
      case 'EXPIRED':
      case 'TIMEOUT':
        return 'EXPIRED';
      default:
        if (status && status.toUpperCase() !== 'PENDING') {
          this.logger.warn(`estado desconhecido do gateway "${status}", tratado como pendente`);
        }
        return 'PENDING';
    }
  }
}
