import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DomainError, isZodLikeError, problem, problemStatus } from './errors';

describe('DomainError', () => {
  it('carries its code, message and context into Problem Details', () => {
    const error = new DomainError('insufficient-stock', 'Só restam 2.', { available: 2 });

    expect(error.toProblem('/api/v1/quotes')).toMatchObject({
      code: 'insufficient-stock',
      status: 409,
      detail: 'Só restam 2.',
      instance: '/api/v1/quotes',
      meta: { available: 2 },
    });
  });

  it('falls back to the title when there is nothing to add', () => {
    expect(new DomainError('not-found').toProblem().detail).toBe(problem('not-found').title);
  });
});

describe('isZodLikeError', () => {
  it('recognises a real ZodError', () => {
    const result = z.object({ qty: z.number() }).safeParse({ qty: 'dois' });

    expect(result.success).toBe(false);
    expect(isZodLikeError(result.success ? null : result.error)).toBe(true);
  });

  /**
   * The case this exists for: the API and the shared package can end up with
   * two copies of the zod module, so the error thrown by a schema is not an
   * instance of the class the HTTP layer imported. Matching by shape survives
   * that; `instanceof` does not, and every invalid request becomes a 500.
   */
  it('recognises one that came from another copy of the module', () => {
    const fromElsewhere = Object.assign(new Error('invalid'), {
      name: 'ZodError',
      issues: [{ path: ['qty'], message: 'Expected number' }],
    });

    expect(isZodLikeError(fromElsewhere)).toBe(true);
    expect(fromElsewhere instanceof z.ZodError).toBe(false);
  });

  it('is not fooled by anything else', () => {
    expect(isZodLikeError(new Error('boom'))).toBe(false);
    expect(isZodLikeError(new DomainError('not-found'))).toBe(false);
    expect(isZodLikeError({ name: 'ZodError' })).toBe(false);
    expect(isZodLikeError(null)).toBe(false);
    expect(isZodLikeError('ZodError')).toBe(false);
  });
});

describe('problemStatus', () => {
  it('keeps the legal refusals distinguishable from ordinary failures', () => {
    expect(problemStatus('adult-declaration-required')).toBe(403);
    expect(problemStatus('alcohol-limit-exceeded')).toBe(409);
    expect(problemStatus('validation-failed')).toBe(400);
  });
});
