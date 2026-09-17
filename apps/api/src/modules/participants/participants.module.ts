import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ParticipantGuard } from './participant.guard';
import { ParticipantsController } from './participants.controller';
import { ParticipantsService } from './participants.service';

@Module({
  imports: [EventsModule],
  controllers: [ParticipantsController],
  providers: [ParticipantsService, ParticipantGuard],
  exports: [ParticipantsService, ParticipantGuard],
})
export class ParticipantsModule {}
