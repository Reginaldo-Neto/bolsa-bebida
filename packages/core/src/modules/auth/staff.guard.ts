import { DomainError } from '@bolsa/shared';
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuthService, STAFF_COOKIE, type StaffContext } from './auth.service';

export interface RequestWithStaff extends FastifyRequest {
  staff?: StaffContext;
}

export const ADMIN_ONLY = 'admin-only';

/** Spec 3: admin routes are for ADMIN, never for STAFF. */
export const AdminOnly = (): MethodDecorator & ClassDecorator => SetMetadata(ADMIN_ONLY, true);

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithStaff>();
    const token = readStaffCookie(request);

    if (!token) {
      throw new DomainError('unauthorized', 'Sessao de staff necessaria.');
    }

    const staff = await this.auth.fromToken(token);
    if (!staff) {
      throw new DomainError('unauthorized', 'Sessao expirada. Volte a entrar.');
    }

    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (adminOnly && staff.role !== 'ADMIN') {
      throw new DomainError('forbidden', 'Apenas administradores podem fazer isto.');
    }

    request.staff = staff;
    return true;
  }
}

export function currentStaff(request: RequestWithStaff): StaffContext {
  if (!request.staff) {
    throw new DomainError('unauthorized', 'Sessao de staff necessaria.');
  }
  return request.staff;
}

function readStaffCookie(request: RequestWithStaff): string | null {
  const raw = request.cookies?.[STAFF_COOKIE];
  if (!raw) {
    return null;
  }
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}
