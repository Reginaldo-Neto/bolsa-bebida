import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { MbWayPaymentProvider } from './mbway-payment.provider';
import { MockPaymentProvider } from './mock-payment.provider';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider';

/**
 * Spec 7: the gateway is chosen by configuration, and the domain only ever
 * sees the PaymentProvider interface.
 */
const providerFactory: Provider = {
  provide: PAYMENT_PROVIDER,
  inject: [ConfigService, MockPaymentProvider],
  useFactory: (config: ConfigService<Env, true>, mock: MockPaymentProvider): PaymentProvider =>
    config.get('PAYMENT_PROVIDER', { infer: true }) === 'mbway'
      ? new MbWayPaymentProvider(config)
      : mock,
};

@Module({
  providers: [MockPaymentProvider, providerFactory],
  exports: [PAYMENT_PROVIDER, MockPaymentProvider],
})
export class PaymentsModule {}
