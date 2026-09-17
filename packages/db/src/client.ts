import { PrismaClient } from '@prisma/client';

export type { PrismaClient } from '@prisma/client';

/** The subset of the client that also exists inside an interactive transaction. */
export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface CreateClientOptions {
  databaseUrl?: string;
  /** Query logging is noisy; keep it opt-in for debugging a slow tick. */
  logQueries?: boolean;
}

export function createPrismaClient(options: CreateClientOptions = {}): PrismaClient {
  return new PrismaClient({
    ...(options.databaseUrl ? { datasources: { db: { url: options.databaseUrl } } } : {}),
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

let singleton: PrismaClient | undefined;

/**
 * Reuses one client per process. Several clients would each open a pool, and a
 * VPS running the API and the worker does not have connections to spare.
 */
export function getPrismaClient(options: CreateClientOptions = {}): PrismaClient {
  singleton ??= createPrismaClient(options);
  return singleton;
}

export async function disconnectPrisma(): Promise<void> {
  await singleton?.$disconnect();
  singleton = undefined;
}
