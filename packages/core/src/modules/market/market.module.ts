import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { TickService } from './tick.service';

@Module({
  imports: [EventsModule],
  controllers: [MarketController],
  providers: [MarketService, TickService],
  exports: [MarketService, TickService],
})
export class MarketModule {}
