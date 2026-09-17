import { Global, Module } from '@nestjs/common';
import { RealtimePublisher } from './realtime.publisher';
import { RedisConnections, redisPublisherProvider } from './redis.provider';

/**
 * Publishing only. Both the API and the worker import this; neither of them
 * needs a socket server to announce something happened.
 *
 * Global because RedisConnections owns the process's two connections, and a
 * second copy would double them.
 */
@Global()
@Module({
  providers: [RedisConnections, redisPublisherProvider, RealtimePublisher],
  exports: [RedisConnections, RealtimePublisher],
})
export class RealtimeModule {}
