import { createPrismaClient, type PrismaClient } from '@bolsa/db';
import { describe } from 'vitest';

/**
 * Integration tests need a real PostgreSQL: the guarantees under test are
 * transactional (conditional updates, row locks, CHECK constraints) and a
 * mocked client would prove nothing about them.
 *
 * They run when DATABASE_URL_TEST is set and are skipped otherwise, so a
 * machine without Docker can still run the rest of the suite. CI always sets
 * it, which is where the F2 acceptance criteria are actually proven. Setting it
 * to an unreachable database fails loudly rather than skipping quietly.
 */
export const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST;

/** describe() that turns into describe.skip when no test database is configured. */
export const describeWithDatabase: typeof describe = TEST_DATABASE_URL
  ? describe
  : (describe.skip as typeof describe);

/**
 * True when the test database is the WASM PGlite of scripts/test-database.mjs,
 * which funnels every connection through one instance and therefore has to run
 * with connection_limit=1.
 *
 * Correctness assertions hold either way. What does not hold is throughput:
 * under a few hundred simultaneous requests, Prisma's pool timeout fires and
 * some requests get no answer at all. Asserting on how many requests were
 * cleanly refused only makes sense against a server that can actually serve
 * them in parallel, which is what CI provides.
 */
export const TEST_DATABASE_IS_SERIALIZED = Boolean(TEST_DATABASE_URL?.includes('pgbouncer=true'));

export function testPrismaClient(): PrismaClient {
  return createPrismaClient({ databaseUrl: TEST_DATABASE_URL });
}

/** Wipes every table between tests, keeping the schema. */
export async function resetDatabase(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_log, redemptions, refunds, invoices, vouchers, payments,
      order_items, orders, quotes, participants, price_ticks,
      product_engine_state, products, product_groups, staff_users,
      idempotency_keys, events
    RESTART IDENTITY CASCADE
  `);
}
