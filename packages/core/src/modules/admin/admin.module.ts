import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MarketModule } from '../market/market.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuthModule, EventsModule, InventoryModule, MarketModule, RealtimeModule],
  controllers: [AdminController],
  providers: [AdminService, ReportsService],
  exports: [AdminService, ReportsService],
})
export class AdminModule {}
