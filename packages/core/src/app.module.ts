import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { parseEnv } from './config/env';
import { HealthController } from './health.controller';
import { EventsModule } from './modules/events/events.module';
import { MarketModule } from './modules/market/market.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ParticipantsModule } from './modules/participants/participants.module';
import { QuotesModule } from './modules/quotes/quotes.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['../../.env'],
      // Tests point at their own database through the environment; reading the
      // developer's .env here would silently send them to the dev database.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: parseEnv,
    }),
    CommonModule,
    EventsModule,
    ParticipantsModule,
    MarketModule,
    QuotesModule,
    OrdersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
