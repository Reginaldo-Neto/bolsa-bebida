import type { Cents } from '@bolsa/shared';

/**
 * L6 (Portaria 363/2010): every payment produces a fiscal document, issued by
 * software certified by the AT. Certifying our own software is a months-long
 * process, so the document is issued through a certified provider's API and
 * this interface is the only thing the domain knows about it.
 */
export interface InvoiceLine {
  description: string;
  quantity: number;
  /** Unit price including VAT, which is how the price was shown and charged. */
  unitPriceCents: Cents;
  /** Basis points: 2300 is 23%. */
  vatBasisPoints: number;
}

export interface InvoiceRequest {
  /** Our order id, sent as the provider's external reference. */
  orderId: string;
  eventName: string;
  issuedAt: Date;
  /** Optional: the participant may decline to give one (L6). */
  customerNif: string | null;
  customerName: string;
  lines: InvoiceLine[];
  totalCents: Cents;
}

export interface InvoiceResult {
  /** The number printed on the document, as the provider assigned it. */
  documentNumber: string;
  /** Where the participant can fetch a copy, when the provider offers one. */
  documentUrl?: string;
}

export abstract class InvoicingProvider {
  abstract readonly name: string;

  abstract issue(request: InvoiceRequest): Promise<InvoiceResult>;
}

export const INVOICING_PROVIDER = Symbol('INVOICING_PROVIDER');
