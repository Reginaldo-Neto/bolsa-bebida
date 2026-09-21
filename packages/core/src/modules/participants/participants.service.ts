import { newId } from '@bolsa/db';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError, type JoinRequest } from '@bolsa/shared';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma.service';
import type { Env } from '../../config/env';
import { EventsService } from '../events/events.service';
import { newSessionId } from './session';

export interface ParticipantContext {
  id: string;
  eventId: string;
  nickname: string;
  isAdultDeclared: boolean;
  leaderboardOptIn: boolean;
  teamCode: string | null;
}

@Injectable()
export class ParticipantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * L7: the only personal data collected here is a nickname. The phone number
   * arrives later, at payment time, and is stored only as a hash.
   */
  async join(
    eventId: string,
    request: JoinRequest,
  ): Promise<{ participant: ParticipantContext; sessionId: string }> {
    const event = await this.events.findById(eventId);
    if (event.status === 'DRAFT' || event.status === 'FINISHED') {
      throw new DomainError('event-not-open', 'O evento nao esta a receber participantes.', {
        status: event.status,
      });
    }

    const sessionId = newSessionId();
    const taken = await this.prisma.client.participant.findUnique({
      where: { eventId_nickname: { eventId, nickname: request.nickname } },
    });
    if (taken) {
      throw new DomainError('validation-failed', 'Esse nickname ja esta a ser usado.', {
        field: 'nickname',
      });
    }

    const participant = await this.prisma.client.participant.create({
      data: {
        id: newId(),
        eventId,
        nickname: request.nickname,
        isAdultDeclared: request.isAdult,
        leaderboardOptIn: request.leaderboardOptIn,
        teamCode: request.teamCode ?? null,
        sessionId,
      },
    });

    return { participant: toContext(participant), sessionId };
  }

  /**
   * The customer standing at the till, who never opened the application.
   *
   * One row per sale rather than one row for the whole till. The alcohol cap
   * of L8 is a limit on a person, and a single shared row would make the
   * counter itself hit that cap after a handful of drinks and stop serving.
   * Nothing personal is stored: no nickname they chose, no phone, and the
   * ranking is off, because a walk-up customer never consented to any of it.
   */
  async createCounterCustomer(
    eventId: string,
    isAdultDeclared: boolean,
  ): Promise<ParticipantContext> {
    const id = newId();

    const participant = await this.prisma.client.participant.create({
      data: {
        id,
        eventId,
        nickname: `Balcao ${id.slice(-8).toUpperCase()}`,
        isAdultDeclared,
        leaderboardOptIn: false,
        isCounter: true,
        sessionId: `counter:${id}`,
      },
    });

    return toContext(participant);
  }

  async findBySession(sessionId: string): Promise<ParticipantContext | null> {
    const participant = await this.prisma.client.participant.findUnique({ where: { sessionId } });
    return participant ? toContext(participant) : null;
  }

  /** L7: the phone number is never stored, only a keyed hash for recovery. */
  hashPhone(phone: string): string {
    return createHmac('sha256', this.config.get('SESSION_SECRET', { infer: true }))
      .update(phone)
      .digest('base64url');
  }

  phoneMatches(phone: string, storedHash: string): boolean {
    const candidate = Buffer.from(this.hashPhone(phone));
    const stored = Buffer.from(storedHash);
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
  }

  async setLeaderboardOptIn(participantId: string, optIn: boolean): Promise<void> {
    await this.prisma.client.participant.update({
      where: { id: participantId },
      data: { leaderboardOptIn: optIn },
    });
  }
}

function toContext(participant: {
  id: string;
  eventId: string;
  nickname: string;
  isAdultDeclared: boolean;
  leaderboardOptIn: boolean;
  teamCode: string | null;
}): ParticipantContext {
  return {
    id: participant.id,
    eventId: participant.eventId,
    nickname: participant.nickname,
    isAdultDeclared: participant.isAdultDeclared,
    leaderboardOptIn: participant.leaderboardOptIn,
    teamCode: participant.teamCode,
  };
}
