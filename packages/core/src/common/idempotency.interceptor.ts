import { createHash } from 'node:crypto';
import { DomainError, idempotencyKeySchema } from '@bolsa/shared';
import { CallHandler, ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type Observable, from, of, switchMap } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from './prisma.service';

interface RequestWithParticipant extends FastifyRequest {
  participant?: { id: string };
}

/**
 * Spec 10.1 and 12.1: every participant POST accepts an Idempotency-Key, so a
 * repeated tap on a bad connection cannot create a second order.
 *
 * The key is claimed with an INSERT, which is atomic: whoever wins runs the
 * handler and stores the answer, and a later replay of the same request gets
 * that same answer back instead of buying another round.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IdempotencyInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithParticipant>();
    const header = request.headers['idempotency-key'];
    const rawKey = Array.isArray(header) ? header[0] : header;

    if (!rawKey) {
      return next.handle();
    }

    const parsed = idempotencyKeySchema.safeParse(rawKey);
    if (!parsed.success) {
      throw new DomainError('validation-failed', 'Idempotency-Key invalida.');
    }

    // Scoped to the participant, so two phones cannot collide on a short key.
    const scope = `${request.method}:${request.url}:${request.participant?.id ?? 'anon'}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? null))
      .digest('hex');

    return from(this.claim(parsed.data, scope, requestHash)).pipe(
      switchMap((replay) => {
        if (replay !== null) {
          return of(replay);
        }

        return next.handle().pipe(
          tap((response: unknown) => {
            void this.remember(parsed.data, response);
          }),
        );
      }),
    );
  }

  /**
   * Returns the stored response when this exact request has been seen before,
   * or null when the caller should run the handler.
   */
  private async claim(key: string, scope: string, requestHash: string): Promise<unknown | null> {
    const existing = await this.prisma.client.idempotencyKey.findUnique({ where: { key } });

    if (!existing) {
      try {
        await this.prisma.client.idempotencyKey.create({ data: { key, scope, requestHash } });
        return null;
      } catch {
        // Lost the race to an identical request that arrived microseconds ago.
        throw new DomainError(
          'idempotency-conflict',
          'Pedido ainda a ser processado. Tente outra vez dentro de momentos.',
        );
      }
    }

    // Same key, different request: the client reused a key by mistake, and
    // answering with the old response would be a lie about what it asked for.
    if (existing.scope !== scope || existing.requestHash !== requestHash) {
      throw new DomainError(
        'idempotency-conflict',
        'Esta Idempotency-Key ja foi usada para um pedido diferente.',
      );
    }

    if (existing.response === null) {
      throw new DomainError(
        'idempotency-conflict',
        'Pedido ainda a ser processado. Tente outra vez dentro de momentos.',
      );
    }

    return existing.response;
  }

  private async remember(key: string, response: unknown): Promise<void> {
    try {
      await this.prisma.client.idempotencyKey.update({
        where: { key },
        data: { response: response as object, statusCode: 201 },
      });
    } catch (error) {
      // The order exists either way; only the replay guarantee is lost.
      this.logger.warn({ err: error, key }, 'nao foi possivel guardar a resposta idempotente');
    }
  }
}
