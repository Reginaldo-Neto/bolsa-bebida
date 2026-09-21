import { DomainError } from '@bolsa/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { InvoiceRequest, InvoiceResult, InvoicingProvider } from './invoicing-provider';

const TIMEOUT_MS = 15_000;

/**
 * Talks to an AT-certified invoicing API over HTTP.
 *
 * Which provider the event will use is still open (spec 14.2), so the request
 * body below follows the shape these APIs converge on rather than any one
 * vendor's. Switching to the chosen provider means editing `toPayload` and
 * `readResult`; everything else — retries, the queue, the failure accounting —
 * is provider-independent and already done.
 */
@Injectable()
export class CertifiedInvoicingProvider implements InvoicingProvider {
  readonly name = 'certified';
  private readonly logger = new Logger(CertifiedInvoicingProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ConfigService<Env, true>) {
    const baseUrl = config.get('INVOICING_API_BASE_URL', { infer: true });
    const apiKey = config.get('INVOICING_API_KEY', { infer: true });

    if (!baseUrl || !apiKey) {
      throw new Error('INVOICING_API_BASE_URL e INVOICING_API_KEY sao obrigatorios (L6).');
    }

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  async issue(request: InvoiceRequest): Promise<InvoiceResult> {
    const response = await fetch(`${this.baseUrl}/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        // The provider must treat a retry of the same order as the same
        // document; issuing two fiscal documents for one sale is a problem
        // that has to be undone by hand at the tax authority.
        'Idempotency-Key': request.orderId,
      },
      body: JSON.stringify(this.toPayload(request)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `a faturacao recusou o documento: ${response.status} (encomenda ${request.orderId})`,
      );
      throw new DomainError(
        'internal-error',
        `A faturacao respondeu ${response.status}: ${detail.slice(0, 200)}`,
      );
    }

    return this.readResult(await response.json());
  }

  private toPayload(request: InvoiceRequest) {
    return {
      reference: request.orderId,
      date: request.issuedAt.toISOString(),
      customer: {
        name: request.customerName,
        // L6: the NIF is optional. Sent as "consumidor final" when absent.
        taxId: request.customerNif ?? '999999990',
      },
      lines: request.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        // Money stays in cents right up to the wire.
        unitPriceCents: line.unitPriceCents,
        vatRate: line.vatBasisPoints / 100,
      })),
      totalCents: request.totalCents,
      notes: request.eventName,
    };
  }

  private readResult(body: unknown): InvoiceResult {
    const payload = body as { documentNumber?: string; number?: string; url?: string };
    const documentNumber = payload.documentNumber ?? payload.number;

    if (!documentNumber) {
      throw new DomainError('internal-error', 'A faturacao nao devolveu o numero do documento.');
    }

    return {
      documentNumber,
      ...(payload.url ? { documentUrl: payload.url } : {}),
    };
  }
}
