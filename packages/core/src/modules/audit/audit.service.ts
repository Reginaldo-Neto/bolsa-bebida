import { Prisma, newId, type ActorType, type AuditLog, type PrismaTransaction } from '@bolsa/db';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../common/prisma.service';

export interface AuditEntry {
  eventId: string;
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Spec 4.7: an append-only record of everything admin and staff do. The table
 * refuses UPDATE and DELETE at the database level, so this is the only way in.
 *
 * Writing an audit entry never fails the action it describes: losing the record
 * of a stock adjustment is bad, but refusing to serve a drink because the log
 * write failed is worse. Failures are logged loudly instead.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuditService.name);
  }

  async record(entry: AuditEntry, tx?: PrismaTransaction): Promise<void> {
    const client = tx ?? this.prisma.client;

    try {
      await client.auditLog.create({
        data: {
          id: newId(),
          eventId: entry.eventId,
          actorType: entry.actorType,
          actorId: entry.actorId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          // Prisma distinguishes "JSON null" from "SQL NULL"; an absent value
          // is the latter.
          before: toJson(entry.before),
          after: toJson(entry.after),
        },
      });
    } catch (error) {
      this.logger.error({ err: error, entry }, 'falhou o registo de auditoria');
    }
  }

  async list(eventId: string, limit = 200): Promise<AuditLog[]> {
    return this.prisma.client.auditLog.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined || value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}
