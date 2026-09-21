import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { CertifiedInvoicingProvider } from './certified-invoicing.provider';
import { INVOICING_PROVIDER, type InvoicingProvider } from './invoicing-provider';
import { InvoicingService } from './invoicing.service';
import { MockInvoicingProvider } from './mock-invoicing.provider';

/** Spec 7: chosen by configuration; the domain only sees the interface. */
const providerFactory: Provider = {
  provide: INVOICING_PROVIDER,
  inject: [ConfigService, MockInvoicingProvider],
  useFactory: (config: ConfigService<Env, true>, mock: MockInvoicingProvider): InvoicingProvider =>
    config.get('INVOICING_PROVIDER', { infer: true }) === 'certified'
      ? new CertifiedInvoicingProvider(config)
      : mock,
};

@Module({
  providers: [MockInvoicingProvider, providerFactory, InvoicingService],
  exports: [INVOICING_PROVIDER, InvoicingService],
})
export class InvoicingModule {}
