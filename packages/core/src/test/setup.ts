/**
 * Runs before any test module is imported.
 *
 * AppModule calls ConfigModule.forRoot() at import time, which validates the
 * environment there and then. Setting these inside a test would be too late.
 */
process.env.NODE_ENV = 'test';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.SESSION_SECRET ??= 'test-session-secret-that-is-long-enough';

// Integration tests use their own database; unit tests never open a connection
// but still need a URL that parses, because the schema validates it eagerly.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://unused:unused@127.0.0.1:1/unused';
