import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { ParticipantsModule } from '../participants/participants.module';
import { PaymentsModule } from '../payments/payments.module';
import { QuotesModule } from '../quotes/quotes.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { ExpiryService } from './expiry.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentPollerService } from '../payments/payment-poller.service';
import { PaymentWebhookController } from './payment-webhook.controller';

@Module({
  imports: [
    EventsModule,
    QuotesModule,
    InventoryModule,
    VouchersModule,
    ParticipantsModule,
    PaymentsModule,
    RealtimeModule,
    InvoicingModule,
  ],
  controllers: [OrdersController, PaymentWebhookController],
  providers: [OrdersService, ExpiryService, PaymentPollerService],
  exports: [OrdersService, ExpiryService, PaymentPollerService],
})
export class OrdersModule {}
