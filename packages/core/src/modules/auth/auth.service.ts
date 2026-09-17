import { hash, verify } from '@node-rs/argon2';
import { newId, type StaffRole } from '@bolsa/db';
import { DomainError, type LoginRequest } from '@bolsa/shared';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TOTP } from 'otpauth';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface StaffContext {
  id: string;
  eventId: string;
  email: string;
  role: StaffRole;
  pickupPoint: string | null;
}

export interface StaffTokenPayload {
  sub: string;
  eventId: string;
  role: StaffRole;
}

/** Spec 12.1: short sessions for anyone who can change prices or stock. */
export const STAFF_SESSION_SECONDS = 8 * 60 * 60;
export const STAFF_COOKIE = 'bb_staff';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Spec 3: staff sign in with email and password; admins must also present a
   * TOTP code. A wrong password and an unknown email fail identically, so the
   * response cannot be used to discover who works here.
   */
  async login(request: LoginRequest): Promise<{ staff: StaffContext; token: string }> {
    const user = await this.prisma.client.staffUser.findUnique({
      where: { eventId_email: { eventId: request.eventId, email: request.email } },
    });

    const invalid = (): never => {
      throw new DomainError('unauthorized', 'Email ou password incorretos.');
    };

    if (!user || !user.active) {
      // Still spend the time an argon2 verification would take.
      await hash('placeholder-for-timing');
      return invalid();
    }

    const passwordMatches = await verify(user.passwordHash, request.password).catch(() => false);
    if (!passwordMatches) {
      await this.audit.record({
        eventId: user.eventId,
        actorType: user.role === 'ADMIN' ? 'ADMIN' : 'STAFF',
        actorId: user.id,
        action: 'auth.login.failed',
        entity: 'staff_user',
        entityId: user.id,
      });
      return invalid();
    }

    if (user.role === 'ADMIN') {
      if (!user.totpSecret) {
        throw new DomainError(
          'forbidden',
          'Esta conta de administrador ainda nao tem 2FA configurado.',
        );
      }
      if (!request.totp || !this.verifyTotp(user.totpSecret, request.totp)) {
        throw new DomainError('unauthorized', 'Codigo de verificacao invalido.');
      }
    }

    const staff: StaffContext = {
      id: user.id,
      eventId: user.eventId,
      email: user.email,
      role: user.role,
      pickupPoint: user.pickupPoint,
    };

    const token = await this.jwt.signAsync(
      { sub: user.id, eventId: user.eventId, role: user.role } satisfies StaffTokenPayload,
      { expiresIn: STAFF_SESSION_SECONDS },
    );

    await this.audit.record({
      eventId: user.eventId,
      actorType: user.role === 'ADMIN' ? 'ADMIN' : 'STAFF',
      actorId: user.id,
      action: 'auth.login',
      entity: 'staff_user',
      entityId: user.id,
    });

    return { staff, token };
  }

  async fromToken(token: string): Promise<StaffContext | null> {
    let payload: StaffTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<StaffTokenPayload>(token);
    } catch {
      return null;
    }

    const user = await this.prisma.client.staffUser.findUnique({ where: { id: payload.sub } });
    if (!user?.active) {
      return null;
    }

    return {
      id: user.id,
      eventId: user.eventId,
      email: user.email,
      role: user.role,
      pickupPoint: user.pickupPoint,
    };
  }

  /**
   * Creates a staff or admin account. Admins get a TOTP secret returned once,
   * here and nowhere else, because it is never stored in a readable form again.
   */
  async createUser(input: {
    eventId: string;
    email: string;
    password: string;
    role: StaffRole;
    pickupPoint?: string | null;
  }): Promise<{ id: string; totpSecret: string | null }> {
    const passwordHash = await hash(input.password);
    const totpSecret = input.role === 'ADMIN' ? new TOTP().secret.base32 : null;

    const user = await this.prisma.client.staffUser.create({
      data: {
        id: newId(),
        eventId: input.eventId,
        email: input.email.toLowerCase(),
        passwordHash,
        role: input.role,
        totpSecret,
        pickupPoint: input.pickupPoint ?? null,
      },
    });

    return { id: user.id, totpSecret };
  }

  private verifyTotp(secret: string, code: string): boolean {
    const totp = new TOTP({ secret });
    // One step of tolerance either way, for clocks that drift.
    return totp.validate({ token: code, window: 1 }) !== null;
  }
}
