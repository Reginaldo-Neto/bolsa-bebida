import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { OrdersModule } from '../orders/orders.module';
import { ParticipantsModule } from '../participants/participants.module';
import { QuotesModule } from '../quotes/quotes.module';
import { CounterController } from './counter.controller';
import { CounterService } from './counter.service';

@Module({
  imports: [AuthModule, EventsModule, ParticipantsModule, QuotesModule, OrdersModule],
  controllers: [CounterController],
  providers: [CounterService],
  exports: [CounterService],
})
export class CounterModule {}
