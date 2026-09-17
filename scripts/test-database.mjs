/**
 * A PostgreSQL for the test suite, without Docker.
 *
 * PGlite is a real PostgreSQL compiled to WASM, so the CHECK constraints,
 * transactions and conditional updates the integration tests rely on behave the
 * same as in production. CI still runs against a real server; this exists so
 * the tests are runnable on a machine that cannot install Docker.
 *
 * Caveat: the socket server multiplexes every client connection onto one PGlite
 * instance, so prepared statement names collide between connections. Prisma
 * must therefore connect with `?connection_limit=1&pgbouncer=true`, which is the
 * same workaround pgbouncer in transaction mode needs.
 */
import { rm } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const PORT = Number(process.env.TEST_DB_PORT ?? 55432);
const DATA_DIR = process.env.TEST_DB_DIR ?? './.pglite-test';

if (process.argv.includes('--fresh')) {
  await rm(DATA_DIR, { recursive: true, force: true });
}

const db = await PGlite.create({ dataDir: DATA_DIR });
const server = new PGLiteSocketServer({
  db,
  port: PORT,
  host: '127.0.0.1',
  maxConnections: 50,
});

await server.start();

console.log(`PGlite a escutar em 127.0.0.1:${PORT}`);
console.log('Use:');
console.log(
  `  DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?connection_limit=1&pgbouncer=true"`,
);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
