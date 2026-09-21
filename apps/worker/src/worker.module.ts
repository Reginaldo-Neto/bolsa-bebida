import {
  AuditModule,
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
    // Global, but a global module still has to be imported somewhere.
    AuditModule,
    EventsModule,
    MarketModule,
    OrdersModule,
    InvoicingModule,
    ParticipantsModule,
  ],
  providers: [SchedulerService],
})
export class WorkerModule {}
