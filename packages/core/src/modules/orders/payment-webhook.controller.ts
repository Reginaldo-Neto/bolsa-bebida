import { DomainError, type PaymentStatus } from '@bolsa/shared';
import { Body, Controller, Headers, Inject, Param, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { Env } from '../../config/env';
import { OrdersService } from './orders.service';
import { MockPaymentProvider } from '../payments/mock-payment.provider';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/payment-provider';

interface RawBodyRequest extends FastifyRequest {
  rawBody?: Buffer;
}

@ApiTags('payments')
@Controller()
export class PaymentWebhookController {
  constructor(
    private readonly orders: OrdersService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Spec 6.1 and 12.1: the signature is verified before anything is trusted,
   * and the handler is idempotent on the gateway's own reference.
   */
  @Post('webhooks/payments/:provider')
  @ApiOperation({ summary: 'Confirmacao de pagamento vinda do gateway' })
  async webhook(
    @Param('provider') providerName: string,
    @Headers() headers: Record<string, unknown>,
    @Req() request: RawBodyRequest,
  ): Promise<{ received: true }> {
    if (providerName !== this.provider.name) {
      throw new DomainError('not-found', 'Gateway desconhecido.');
    }

    const rawBody = request.rawBody?.toString('utf8') ?? JSON.stringify(request.body ?? {});
    const event = this.provider.verifyWebhook(headers, rawBody);

    await this.orders.settle(event.providerRef, event.status, { raw: event.raw });
    return { received: true };
  }

  /**
   * Development only: stands in for the participant confirming in the MB WAY
   * app. It goes through the same settle() path as a real webhook.
   */
  @Post('dev/payments/:providerRef/:status')
  @ApiExcludeEndpoint()
  async simulate(
    @Param('providerRef') providerRef: string,
    @Param('status') status: string,
    @Body() _body: unknown,
  ): Promise<{ applied: boolean }> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new DomainError('not-found', 'Rota indisponivel.');
    }
    if (!(this.provider instanceof MockPaymentProvider)) {
      throw new DomainError('forbidden', 'O gateway ativo nao permite simulacao.');
    }
    if (!isPaymentStatus(status)) {
      throw new DomainError('validation-failed', `Estado invalido: ${status}`);
    }

    const event = this.provider.simulateCallback(providerRef, status);
    return this.orders.settle(event.providerRef, event.status, { raw: event.raw });
  }
}

function isPaymentStatus(value: string): value is PaymentStatus {
  return value === 'PENDING' || value === 'PAID' || value === 'FAILED' || value === 'EXPIRED';
}
