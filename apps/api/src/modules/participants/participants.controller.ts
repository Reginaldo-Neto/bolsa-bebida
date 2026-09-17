import { joinRequestSchema, type JoinRequest } from '@bolsa/shared';
import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { zodPipe } from '../../common/zod.pipe';
import type { Env } from '../../config/env';
import {
  ParticipantGuard,
  currentParticipant,
  type RequestWithParticipant,
} from './participant.guard';
import { ParticipantsService, type ParticipantContext } from './participants.service';
import { setSessionCookie } from './session';

@ApiTags('participants')
@Controller()
export class ParticipantsController {
  constructor(
    private readonly participants: ParticipantsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('events/:eventId/join')
  @ApiOperation({ summary: 'Cria uma sessao anonima de participante' })
  async join(
    @Param('eventId') eventId: string,
    @Body(zodPipe(joinRequestSchema)) body: JoinRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ParticipantContext> {
    const { participant, sessionId } = await this.participants.join(eventId, body);

    setSessionCookie(
      reply,
      sessionId,
      this.config.get('NODE_ENV', { infer: true }) === 'production',
    );

    return participant;
  }

  @Get('me')
  @UseGuards(ParticipantGuard)
  @ApiOperation({ summary: 'Devolve o participante da sessao atual' })
  me(@Req() request: RequestWithParticipant): ParticipantContext {
    return currentParticipant(request);
  }
}
