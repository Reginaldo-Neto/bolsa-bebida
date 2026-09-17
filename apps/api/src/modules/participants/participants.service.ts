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
