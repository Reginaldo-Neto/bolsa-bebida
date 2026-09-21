import type { StaffRole } from '@bolsa/db';
import { DomainError } from '@bolsa/shared';
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuthService, STAFF_COOKIE, type StaffContext } from './auth.service';

export interface RequestWithStaff extends FastifyRequest {
  staff?: StaffContext;
}

export const ALLOWED_ROLES = 'allowed-roles';

/**
 * Restricts a route to certain bar roles.
 *
 * ADMIN always passes: the person who can pause the market and change prices
 * is not going to be stopped from opening the till. Everyone else needs their
 * role named, so a STAFF account that only hands drinks over cannot sell.
 */
export const Roles = (...roles: StaffRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOWED_ROLES, roles);

/** Spec 3: admin routes are for ADMIN, never for STAFF. */
export const AdminOnly = (): MethodDecorator & ClassDecorator => Roles('ADMIN');

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

    const allowed = this.reflector.getAllAndOverride<StaffRole[]>(ALLOWED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (allowed?.length && staff.role !== 'ADMIN' && !allowed.includes(staff.role)) {
      throw new DomainError(
        'forbidden',
        allowed.includes('ADMIN')
          ? 'Apenas administradores podem fazer isto.'
          : 'Esta conta nao tem permissao para fazer isto.',
      );
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
