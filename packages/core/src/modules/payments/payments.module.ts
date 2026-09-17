import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { MockPaymentProvider } from './mock-payment.provider';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider';

/**
 * Spec 7: the gateway is chosen by configuration, and the domain only ever
 * sees the PaymentProvider interface. The real MB WAY adapter arrives in F5.
 */
const providerFactory: Provider = {
  provide: PAYMENT_PROVIDER,
  inject: [ConfigService, MockPaymentProvider],
  useFactory: (config: ConfigService<Env, true>, mock: MockPaymentProvider): PaymentProvider => {
    const selected = config.get('PAYMENT_PROVIDER', { infer: true });
    if (selected === 'mock') {
      return mock;
    }
    throw new Error(`O adapter de pagamento "${selected}" ainda nao esta implementado (F5).`);
  },
};

@Module({
  providers: [MockPaymentProvider, providerFactory],
  exports: [PAYMENT_PROVIDER, MockPaymentProvider],
})
export class PaymentsModule {}
