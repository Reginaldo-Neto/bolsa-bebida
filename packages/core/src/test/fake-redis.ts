import { EventEmitter } from 'node:events';

/**
 * An in-process stand-in for the pub/sub side of ioredis.
 *
 * Tests should not need a Redis server to prove that an order was settled. The
 * real client retries forever on purpose, which would also keep the test
 * process alive long after the assertions finished.
 *
 * Delivery is synchronous and local, so a test can publish and immediately
 * assert on what a subscriber received.
 */
export class FakeRedis extends EventEmitter {
  private static readonly bus = new EventEmitter();
  private readonly channels = new Set<string>();
  readonly published: { channel: string; message: string }[] = [];

  constructor() {
    super();
    FakeRedis.bus.setMaxListeners(100);
  }

  publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    FakeRedis.bus.emit(channel, message);
    return Promise.resolve(1);
  }

  subscribe(channel: string): Promise<number> {
    if (!this.channels.has(channel)) {
      this.channels.add(channel);
      FakeRedis.bus.on(channel, this.forward);
    }
    return Promise.resolve(this.channels.size);
  }

  unsubscribe(channel?: string): Promise<number> {
    const targets = channel ? [channel] : [...this.channels];
    for (const target of targets) {
      FakeRedis.bus.off(target, this.forward);
      this.channels.delete(target);
    }
    return Promise.resolve(this.channels.size);
  }

  quit(): Promise<'OK'> {
    void this.unsubscribe();
    return Promise.resolve('OK');
  }

  disconnect(): void {
    void this.unsubscribe();
  }

  private readonly forward = (message: string): void => {
    for (const channel of this.channels) {
      this.emit('message', channel, message);
    }
  };
}

/** Matches the shape RealtimeModule exports, so it can replace it wholesale. */
export class FakeRedisConnections {
  readonly publisher = new FakeRedis();
  readonly subscriber = new FakeRedis();

  onModuleDestroy(): void {
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }
}
