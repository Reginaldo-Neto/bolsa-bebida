import { Module } from '@nestjs/common';
import { ParticipantsModule } from '../participants/participants.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeModule } from './realtime.module';
import { redisSubscriberProvider } from './redis.provider';

/**
 * The socket server itself. Only the API imports this: the worker publishes
 * events but never holds connections.
 */
@Module({
  imports: [ParticipantsModule, RealtimeModule],
  providers: [redisSubscriberProvider, RealtimeGateway],
})
export class RealtimeGatewayModule {}
