import { leaderboardOptInSchema, type LeaderboardOptInRequest } from '@bolsa/shared';
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { zodPipe } from '../../common/zod.pipe';
import {
  ParticipantGuard,
  currentParticipant,
  type RequestWithParticipant,
} from '../participants/participant.guard';
import { LeaderboardService, type LeaderboardView } from './leaderboard.service';

@ApiTags('leaderboard')
@Controller()
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  /**
   * Public, because the big screen shows the top five without a session
   * (spec 4.8). Only participants who opted in appear.
   */
  @Get('events/:eventId/leaderboard')
  @ApiOperation({ summary: 'Ranking Melhor Trader' })
  publicBoard(@Param('eventId') eventId: string): Promise<LeaderboardView> {
    return this.leaderboard.view(eventId);
  }

  @Get('leaderboard')
  @UseGuards(ParticipantGuard)
  @ApiOperation({ summary: 'Ranking, incluindo a posicao do proprio participante' })
  myBoard(@Req() request: RequestWithParticipant): Promise<LeaderboardView> {
    const participant = currentParticipant(request);
    return this.leaderboard.view(participant.eventId, participant.id);
  }

  @Post('me/leaderboard')
  @UseGuards(ParticipantGuard)
  @ApiOperation({ summary: 'Entrar ou sair do ranking' })
  setOptIn(
    @Req() request: RequestWithParticipant,
    @Body(zodPipe(leaderboardOptInSchema)) body: LeaderboardOptInRequest,
  ): Promise<{ optedIn: boolean }> {
    return this.leaderboard.setOptIn(currentParticipant(request).id, body.optIn);
  }
}
