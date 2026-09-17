import { DomainError } from '@bolsa/shared';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ParticipantsService, type ParticipantContext } from './participants.service';
import { readSessionCookie } from './session';

export interface RequestWithParticipant extends FastifyRequest {
  participant?: ParticipantContext;
}

@Injectable()
export class ParticipantGuard implements CanActivate {
  constructor(private readonly participants: ParticipantsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithParticipant>();
    const sessionId = readSessionCookie(request);
    if (!sessionId) {
      throw new DomainError('unauthorized', 'Sessao nao encontrada. Volte a ler o QR Code.');
    }

    const participant = await this.participants.findBySession(sessionId);
    if (!participant) {
      throw new DomainError('unauthorized', 'Sessao expirada. Volte a ler o QR Code.');
    }

    request.participant = participant;
    return true;
  }
}

/** Reads the participant a ParticipantGuard has already attached. */
export function currentParticipant(request: RequestWithParticipant): ParticipantContext {
  if (!request.participant) {
    throw new DomainError('unauthorized', 'Sessao nao encontrada.');
  }
  return request.participant;
}
