import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://bolsa:bolsa@localhost:5432/bolsa',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('fills in the development defaults', () => {
    const env = parseEnv(base as NodeJS.ProcessEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
    expect(env.PAYMENT_PROVIDER).toBe('mock');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('splits the CORS origin list', () => {
    const env = parseEnv({
      ...base,
      CORS_ORIGINS: 'https://a.pt, https://b.pt ',
    } as NodeJS.ProcessEnv);

    expect(env.CORS_ORIGINS).toEqual(['https://a.pt', 'https://b.pt']);
  });

  it('rejects a short session secret', () => {
    expect(() => parseEnv({ ...base, SESSION_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(
      /SESSION_SECRET/,
    );
  });

  it('rejects a missing database url', () => {
    expect(() => parseEnv({ SESSION_SECRET: base.SESSION_SECRET } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL/,
    );
  });

  describe('production guards', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'mbway',
      MBWAY_WEBHOOK_SECRET: 'secret',
      INVOICING_PROVIDER: 'certified',
      VOUCHER_SIGNING_PRIVATE_KEY: 'key',
      VOUCHER_SIGNING_PUBLIC_KEY: 'key',
    } as NodeJS.ProcessEnv;

    it('accepts a complete production configuration', () => {
      expect(() => parseEnv(production)).not.toThrow();
    });

    it('refuses the mock payment provider', () => {
      expect(() => parseEnv({ ...production, PAYMENT_PROVIDER: 'mock' })).toThrow(
        /mock payment provider/,
      );
    });

    it('refuses MB WAY without a webhook secret', () => {
      const { MBWAY_WEBHOOK_SECRET: _omitted, ...withoutSecret } = production;
      expect(() => parseEnv(withoutSecret as NodeJS.ProcessEnv)).toThrow(/MBWAY_WEBHOOK_SECRET/);
    });

    it('refuses mock invoicing, because L6 requires certified software', () => {
      expect(() => parseEnv({ ...production, INVOICING_PROVIDER: 'mock' })).toThrow(/L6/);
    });

    it('refuses to run without voucher signing keys', () => {
      const { VOUCHER_SIGNING_PRIVATE_KEY: _omitted, ...withoutKey } = production;
      expect(() => parseEnv(withoutKey as NodeJS.ProcessEnv)).toThrow(/voucher signing keys/);
    });
  });
});
