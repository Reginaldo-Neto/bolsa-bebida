import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';

const BATCH_SIZE = 500;

/**
 * L7 and spec 12.2: personal data is anonymised a configurable number of days
 * after the event, while aggregate and fiscal data stay for as long as the law
 * requires.
 *
 * Rows are anonymised, never deleted. Deleting a participant would take their
 * orders with them, and those are the fiscal record of money that changed
 * hands — the one thing that must not disappear. What goes is the link between
 * a person and those orders: the nickname, the phone hash, the team.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async anonymizeExpired(now: Date = new Date()): Promise<number> {
    const events = await this.prisma.client.event.findMany({
      where: { status: 'FINISHED' },
      select: { id: true, name: true, retentionDays: true, endsAt: true, updatedAt: true },
    });

    let total = 0;

    for (const event of events) {
      // Falls back to when the event was last touched, for an event that was
      // finished without an end date ever being set.
      const reference = event.endsAt ?? event.updatedAt;
      const due = new Date(reference.getTime() + event.retentionDays * 86_400_000);

      if (due > now) {
        continue;
      }

      total += await this.anonymizeEvent(event.id, now);
    }

    return total;
  }

  /** Spec 12.2: also the path for an individual erasure request. */
  async anonymizeEvent(eventId: string, now: Date = new Date()): Promise<number> {
    const participants = await this.prisma.client.participant.findMany({
      where: { eventId, anonymizedAt: null },
      select: { id: true },
      take: BATCH_SIZE,
    });

    if (participants.length === 0) {
      return 0;
    }

    let anonymized = 0;

    for (const participant of participants) {
      // The nickname is unique per event, so the placeholder has to be unique
      // too. The tail of the id already is.
      const placeholder = `Participante ${participant.id.slice(-6)}`;

      try {
        await this.prisma.client.participant.update({
          where: { id: participant.id },
          data: {
            nickname: placeholder,
            phoneHash: null,
            teamCode: null,
            // Leaving the ranking is part of forgetting them.
            leaderboardOptIn: false,
            // The session id is a credential; a stale one must not keep working.
            sessionId: `anonymized:${participant.id}`,
            anonymizedAt: now,
          },
        });
        anonymized += 1;
      } catch (error) {
        this.logger.error(
          { err: error, participantId: participant.id },
          'falhou a anonimizacao de um participante',
        );
      }
    }

    if (anonymized > 0) {
      await this.audit.record({
        eventId,
        actorType: 'SYSTEM',
        action: 'participants.anonymized',
        entity: 'participant',
        after: { count: anonymized },
      });
      this.logger.log({ eventId, count: anonymized }, 'dados pessoais anonimizados');
    }

    return anonymized;
  }

  /** What the admin panel shows before anyone asks where the data went. */
  async status(eventId: string): Promise<{
    retentionDays: number;
    anonymizeAfter: string | null;
    pending: number;
    anonymized: number;
  }> {
    const event = await this.prisma.client.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { retentionDays: true, endsAt: true, updatedAt: true, status: true },
    });

    const [pending, anonymized] = await Promise.all([
      this.prisma.client.participant.count({ where: { eventId, anonymizedAt: null } }),
      this.prisma.client.participant.count({ where: { eventId, anonymizedAt: { not: null } } }),
    ]);

    const reference = event.endsAt ?? event.updatedAt;

    return {
      retentionDays: event.retentionDays,
      anonymizeAfter:
        event.status === 'FINISHED'
          ? new Date(reference.getTime() + event.retentionDays * 86_400_000).toISOString()
          : null,
      pending,
      anonymized,
    };
  }
}
