import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { ParticipantsModule } from '../participants/participants.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [AuthModule, EventsModule, VouchersModule, RealtimeModule, ParticipantsModule],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
