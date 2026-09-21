import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { TickService } from './tick.service';

@Module({
  imports: [EventsModule, RealtimeModule, LeaderboardModule],
  controllers: [MarketController],
  providers: [MarketService, TickService],
  exports: [MarketService, TickService],
})
export class MarketModule {}
