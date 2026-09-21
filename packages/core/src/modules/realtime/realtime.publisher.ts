import {
  REALTIME_CHANNEL,
  type RealtimeMessage,
  type ServerEventName,
  type ServerEvents,
} from '@bolsa/shared';
import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Redis } from 'ioredis';
import { REDIS_PUBLISHER } from './redis.provider';

/**
 * Spec 8: the worker computes a tick, writes it and publishes it; the API
 * relays it to connected clients. Both processes publish through here.
 *
 * Publishing never throws. A phone missing a price update is a cosmetic
 * problem; a payment failing because Redis blinked is not.
 */
@Injectable()
export class RealtimePublisher {
  constructor(
    @Inject(REDIS_PUBLISHER) private readonly redis: Redis,
    @InjectPinoLogger(RealtimePublisher.name) private readonly logger: PinoLogger,
  ) {}

  publish<K extends ServerEventName>(room: string, event: K, payload: ServerEvents[K]): void {
    const message: RealtimeMessage = { room, event, payload };

    this.redis.publish(REALTIME_CHANNEL, JSON.stringify(message)).catch((error: unknown) => {
      this.logger.warn({ err: error, room, event }, 'nao foi possivel publicar o evento');
    });
  }
}
