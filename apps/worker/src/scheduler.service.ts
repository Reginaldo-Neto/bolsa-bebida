import {
  ExpiryService,
  InvoicingService,
  PaymentPollerService,
  PrismaService,
  TickService,
} from '@bolsa/core';
import type { Env } from '@bolsa/core';
import { PAYMENT_POLL_INTERVAL_SECONDS, parseEngineParams } from '@bolsa/shared';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

const QUEUE_NAME = 'bolsa';

type JobName = 'tick' | 'expire' | 'poll-payments' | 'invoices';

/**
 * Spec 8: the worker runs the market tick and the housekeeping jobs.
 *
 * A single repeatable job asks "which events are due?" rather than one
 * repeatable per event, so an admin changing tickSeconds mid-party takes effect
 * on the next sweep instead of needing the schedule rebuilt (spec 4.7).
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly connection: Redis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly ticks: TickService,
    private readonly expiry: ExpiryService,
    private readonly poller: PaymentPollerService,
    private readonly invoicing: InvoicingService,
  ) {
    this.connection = new Redis(this.config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
  }

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(QUEUE_NAME, { connection: this.connection });
    this.worker = new Worker(
      QUEUE_NAME,
      (job) => this.process(job as Job<unknown, void, JobName>),
      {
        connection: this.connection,
        concurrency: 4,
      },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error({ err: error, job: job?.name }, 'job failed');
    });

    await this.scheduleRepeatables();
    this.logger.log('worker pronto');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection.disconnect();
  }

  private async scheduleRepeatables(): Promise<void> {
    const queue = this.queue;
    if (!queue) {
      return;
    }

    const jobs: [JobName, number][] = [
      // Sweeps every 10s; each event still only ticks every tickSeconds.
      ['tick', 10_000],
      ['expire', 10_000],
      ['poll-payments', PAYMENT_POLL_INTERVAL_SECONDS * 1000],
      // L6: documents owed are retried until they are issued.
      ['invoices', 30_000],
    ];

    for (const [name, every] of jobs) {
      // upsert, not add: restarting the worker must not stack up duplicate
      // schedules for the same job.
      await queue.upsertJobScheduler(
        `repeat:${name}`,
        { every },
        { name, data: {}, opts: { removeOnComplete: 100, removeOnFail: 500 } },
      );
    }
  }

  private async process(job: Job<unknown, void, JobName>): Promise<void> {
    switch (job.name) {
      case 'tick':
        await this.tickDueEvents();
        return;
      case 'expire': {
        const quotes = await this.expiry.expireQuotes();
        const orders = await this.expiry.expireOrders();
        if (quotes || orders) {
          this.logger.log({ quotes, orders }, 'reservas libertadas');
        }
        return;
      }
      case 'poll-payments': {
        const result = await this.poller.pollPending();
        if (result.settled > 0) {
          this.logger.log(result, 'pagamentos resolvidos por consulta ao gateway');
        }
        return;
      }
      case 'invoices': {
        const result = await this.invoicing.processPending();
        if (result.issued > 0 || result.failed > 0) {
          this.logger.log(result, 'documentos fiscais');
        }
        return;
      }
    }
  }

  private async tickDueEvents(): Promise<void> {
    const events = await this.prisma.client.event.findMany({
      where: { status: 'OPEN', fixedPrices: false },
      select: { id: true, lastTickAt: true, engineParams: true },
    });

    const now = Date.now();
    for (const event of events) {
      const { tickSeconds } = parseEngineParams(event.engineParams);
      const due = !event.lastTickAt || now - event.lastTickAt.getTime() >= tickSeconds * 1000;
      if (!due) {
        continue;
      }

      await this.withEventLock(event.id, tickSeconds, async () => {
        const result = await this.ticks.runFor(event.id);
        if (result.skipped) {
          this.logger.debug({ eventId: event.id, reason: result.skipped }, 'tick ignorado');
        }
      });
    }
  }

  /**
   * Spec 8.3: only one worker ticks a given event. The lock expires on its own,
   * so a worker that dies mid-tick does not freeze the market until someone
   * notices.
   */
  private async withEventLock(
    eventId: string,
    tickSeconds: number,
    run: () => Promise<void>,
  ): Promise<void> {
    const key = `lock:tick:${eventId}`;
    const token = `${process.pid}:${Date.now()}`;
    const ttl = Math.max(5_000, tickSeconds * 1000);

    const acquired = await this.connection.set(key, token, 'PX', ttl, 'NX');
    if (acquired !== 'OK') {
      return;
    }

    try {
      await run();
    } finally {
      // Only release a lock we still hold, never someone else's.
      const current = await this.connection.get(key);
      if (current === token) {
        await this.connection.del(key);
      }
    }
  }
}
