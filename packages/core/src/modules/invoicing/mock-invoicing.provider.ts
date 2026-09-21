import { Injectable, Logger } from '@nestjs/common';
import type { InvoiceRequest, InvoiceResult, InvoicingProvider } from './invoicing-provider';

/**
 * Development stand-in for certified invoicing software.
 *
 * The env schema refuses to boot with this provider when NODE_ENV=production,
 * because a party that sells drinks without fiscal documents is breaking L6,
 * not just running with a stub.
 */
@Injectable()
export class MockInvoicingProvider implements InvoicingProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockInvoicingProvider.name);
  private sequence = 0;

  issue(request: InvoiceRequest): Promise<InvoiceResult> {
    this.sequence += 1;
    const documentNumber = `MOCK/${new Date().getFullYear()}/${String(this.sequence).padStart(5, '0')}`;

    this.logger.log(
      `documento fiscal simulado ${documentNumber} para a encomenda ${request.orderId}`,
    );

    return Promise.resolve({ documentNumber });
  }
}
