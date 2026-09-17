import { DomainError, problem, type ProblemDetails } from '@bolsa/shared';
import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/**
 * Every error leaves the API as RFC 9457 Problem Details (spec 10), so the PWA
 * can branch on a stable `code` instead of parsing prose.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const instance = request.url;

    const details = this.toProblem(exception, instance);

    if (details.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { err: exception, instance, code: details.code },
        'unhandled error while serving request',
      );
    }

    void reply.status(details.status).type('application/problem+json').send(details);
  }

  private toProblem(exception: unknown, instance: string): ProblemDetails {
    if (exception instanceof DomainError) {
      return exception.toProblem(instance);
    }

    if (exception instanceof ZodError) {
      return problem('validation-failed', {
        instance,
        detail: 'Os dados enviados nao sao validos.',
        meta: {
          issues: exception.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception, instance);
    }

    return problem('internal-error', { instance });
  }

  private fromHttpException(exception: HttpException, instance: string): ProblemDetails {
    const status = exception.getStatus();
    const base = problem(PROBLEM_BY_STATUS[status] ?? 'internal-error', { instance });
    const response = exception.getResponse();
    const detail =
      typeof response === 'string'
        ? response
        : ((response as { message?: string | string[] }).message ?? exception.message);

    return {
      ...base,
      status,
      detail: Array.isArray(detail) ? detail.join('; ') : detail,
    };
  }
}

const PROBLEM_BY_STATUS: Record<number, ProblemDetails['code']> = {
  [HttpStatus.BAD_REQUEST]: 'validation-failed',
  [HttpStatus.UNAUTHORIZED]: 'unauthorized',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'not-found',
  [HttpStatus.REQUEST_TIMEOUT]: 'payment-timeout',
  [HttpStatus.CONFLICT]: 'idempotency-conflict',
  [HttpStatus.TOO_MANY_REQUESTS]: 'rate-limited',
};
