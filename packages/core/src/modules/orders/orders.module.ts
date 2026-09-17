import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ParticipantsModule } from '../participants/participants.module';
import { PaymentsModule } from '../payments/payments.module';
import { QuotesModule } from '../quotes/quotes.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentWebhookController } from './payment-webhook.controller';

@Module({
  imports: [
    EventsModule,
    QuotesModule,
    InventoryModule,
    VouchersModule,
    ParticipantsModule,
    PaymentsModule,
  ],
  controllers: [OrdersController, PaymentWebhookController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
