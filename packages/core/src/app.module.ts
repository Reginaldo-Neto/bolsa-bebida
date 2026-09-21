import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { LoggingModule } from './common/logging.module';
import { parseEnv } from './config/env';
import { HealthController } from './health.controller';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CounterModule } from './modules/counter/counter.module';
import { EventsModule } from './modules/events/events.module';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
import { MarketModule } from './modules/market/market.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ParticipantsModule } from './modules/participants/participants.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { StaffModule } from './modules/staff/staff.module';
import { RealtimeGatewayModule } from './modules/realtime/realtime-gateway.module';

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
    LoggingModule,
    CommonModule,
    AuditModule,
    AuthModule,
    EventsModule,
    ParticipantsModule,
    MarketModule,
    LeaderboardModule,
    QuotesModule,
    OrdersModule,
    StaffModule,
    CounterModule,
    AdminModule,
    RealtimeGatewayModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
