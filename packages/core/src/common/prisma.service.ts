import { createPrismaClient, type PrismaClient } from '@bolsa/db';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

/**
 * Thin Nest wrapper around the shared Prisma client. Data access stays in
 * @bolsa/db; this only ties the connection to the module lifecycle.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(config: ConfigService<Env, true>) {
    this.client = createPrismaClient({
      databaseUrl: config.get('DATABASE_URL', { infer: true }),
      // Off unless asked for: every query on screen buries the lines that
      // actually say what the system did.
      logQueries: process.env.LOG_QUERIES === 'true',
    });
  }

  // Connecting lazily on the first query means a database that is briefly down
  // leaves the API up and reporting "degraded" on /health, instead of a crash
  // loop in the middle of the party.
  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
