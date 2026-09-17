import { quoteRequestSchema, type QuoteRequest, type QuoteResponse } from '@bolsa/shared';
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { zodPipe } from '../../common/zod.pipe';
import {
  ParticipantGuard,
  currentParticipant,
  type RequestWithParticipant,
} from '../participants/participant.guard';
import { QuotesService } from './quotes.service';

@ApiTags('quotes')
@Controller('quotes')
@UseGuards(ParticipantGuard)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma cotacao com precos bloqueados e reserva de stock' })
  create(
    @Req() request: RequestWithParticipant,
    @Body(zodPipe(quoteRequestSchema)) body: QuoteRequest,
  ): Promise<QuoteResponse> {
    return this.quotes.create(currentParticipant(request), body);
  }
}
