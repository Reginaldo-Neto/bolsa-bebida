import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '../config/env';

/**
 * Spec 13.3: JSON logs carrying eventId, orderId and tick on every line that
 * has one, so a problem during the party can be traced without guessing.
 *
 * Pretty-printed in development, where a human reads them; JSON in production,
 * where a log collector does.
 *
 * Global because @InjectPinoLogger(Name) resolves a provider created per
 * context by LoggerModule. Without this, every module would have to import
 * logging before it could log.
 */
@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

        return {
          pinoHttp: {
            level: isProduction ? 'info' : 'debug',
            ...(isProduction
              ? {}
              : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),

            // A request id on every line, so one participant's journey can be
            // followed through the logs.
            genReqId: (request) =>
              (request.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID(),

            // Never log a session cookie, a phone number or a payment secret.
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'req.headers["idempotency-key"]',
                'req.body.phone',
                'req.body.password',
                'req.body.totp',
                'req.body.nif',
                'res.headers["set-cookie"]',
              ],
              remove: true,
            },

            // The health check runs every fifteen seconds all night.
            autoLogging: {
              ignore: (request) => request.url === '/health',
            },

            customProps: (request) => ({
              participantId: (request as { participant?: { id: string } }).participant?.id,
            }),
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
