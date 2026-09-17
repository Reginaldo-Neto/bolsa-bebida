import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';

@Module({
  imports: [EventsModule],
  controllers: [MarketController],
  providers: [MarketService],
  exports: [MarketService],
})
export class MarketModule {}
