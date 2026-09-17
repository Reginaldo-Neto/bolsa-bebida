import { randomBytes } from 'node:crypto';
// Side-effect import: @fastify/cookie augments FastifyRequest and FastifyReply
// with setCookie/unsignCookie, and the augmentation only loads if it is imported.
import type {} from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Spec 3: the participant never registers. Reading the QR creates an anonymous
 * session in an httpOnly cookie, which is also the CSRF boundary (spec 12.1).
 */
export const SESSION_COOKIE = 'bb_session';

export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function setSessionCookie(reply: FastifyReply, sessionId: string, secure: boolean): void {
  void reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    signed: true,
    path: '/',
    // The session only has to outlive the party.
    maxAge: 60 * 60 * 24,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Returns the session id only when the cookie signature is intact. */
export function readSessionCookie(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) {
    return null;
  }

  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}
