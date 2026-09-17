import { Injectable, Logger, type OnModuleDestroy, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env';

export const REDIS_PUBLISHER = Symbol('REDIS_PUBLISHER');
export const REDIS_SUBSCRIBER = Symbol('REDIS_SUBSCRIBER');

/**
 * Redis carries live prices to connected phones. It is never the source of
 * truth for stock or money (spec 8.3), so an unreachable Redis must degrade the
 * experience, not break a purchase: connections are lazy and errors are logged
 * rather than thrown.
 *
 * One publisher and one subscriber, because a connection in subscriber mode
 * cannot run ordinary commands.
 */
@Injectable()
export class RedisConnections implements OnModuleDestroy {
  private readonly logger = new Logger(RedisConnections.name);
  readonly publisher: Redis;
  readonly subscriber: Redis;

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('REDIS_URL', { infer: true });
    this.publisher = this.connect(url, 'publisher');
    this.subscriber = this.connect(url, 'subscriber');
  }

  async onModuleDestroy(): Promise<void> {
    // quit() waits for pending replies; a dead server would hang it, so the
    // forceful disconnect is the fallback.
    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }

  private connect(url: string, role: string): Redis {
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      // Keeps retrying for the whole party: Redis restarting must not leave
      // the market permanently silent.
      retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
    });

    let warned = false;
    client.on('error', (error: Error) => {
      if (!warned) {
        warned = true;
        this.logger.warn(`Redis (${role}) indisponivel: ${error.message}`);
      }
    });
    client.on('ready', () => {
      warned = false;
    });

    void client.connect().catch(() => {
      // The retry strategy keeps trying in the background.
    });

    return client;
  }
}

export const redisPublisherProvider: Provider = {
  provide: REDIS_PUBLISHER,
  inject: [RedisConnections],
  useFactory: (connections: RedisConnections): Redis => connections.publisher,
};

export const redisSubscriberProvider: Provider = {
  provide: REDIS_SUBSCRIBER,
  inject: [RedisConnections],
  useFactory: (connections: RedisConnections): Redis => connections.subscriber,
};
