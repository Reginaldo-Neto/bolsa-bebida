import { z } from 'zod';

/**
 * The process refuses to start with a bad configuration. During an event a
 * missing signing key or payment secret must fail at boot, not at the first
 * voucher.
 */
/** An env var that is present but empty means "not configured", not "invalid". */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),

    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

    /** Ed25519 key pair for voucher QR signatures (spec 10.3), base64 PKCS8/SPKI. */
    VOUCHER_SIGNING_PRIVATE_KEY: optional(z.string()),
    VOUCHER_SIGNING_PUBLIC_KEY: optional(z.string()),

    PAYMENT_PROVIDER: z.enum(['mock', 'mbway']).default('mock'),
    MBWAY_API_BASE_URL: optional(z.string().url()),
    MBWAY_API_KEY: optional(z.string()),
    MBWAY_WEBHOOK_SECRET: optional(z.string()),

    INVOICING_PROVIDER: z.enum(['mock', 'certified']).default('mock'),
    INVOICING_API_BASE_URL: optional(z.string().url()),
    INVOICING_API_KEY: optional(z.string()),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') {
      return;
    }

    if (env.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_PROVIDER'],
        message: 'the mock payment provider must never run in production',
      });
    }
    if (env.PAYMENT_PROVIDER === 'mbway' && !env.MBWAY_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MBWAY_WEBHOOK_SECRET'],
        message: 'MB WAY webhooks cannot be verified without a secret',
      });
    }
    // L6: every payment must produce a fiscal document.
    if (env.INVOICING_PROVIDER === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['INVOICING_PROVIDER'],
        message: 'L6 requires certified invoicing software in production',
      });
    }
    if (!env.VOUCHER_SIGNING_PRIVATE_KEY || !env.VOUCHER_SIGNING_PUBLIC_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VOUCHER_SIGNING_PRIVATE_KEY'],
        message: 'voucher signing keys are required in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
