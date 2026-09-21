import {
  CommonModule,
  EventsModule,
  InvoicingModule,
  LoggingModule,
  MarketModule,
  OrdersModule,
  ParticipantsModule,
  parseEnv,
} from '@bolsa/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['../../.env'],
      validate: parseEnv,
    }),
    LoggingModule,
    CommonModule,
    EventsModule,
    MarketModule,
    OrdersModule,
    InvoicingModule,
    LoggingModule,
    ParticipantsModule,
  ],
  providers: [SchedulerService],
})
export class WorkerModule {}
