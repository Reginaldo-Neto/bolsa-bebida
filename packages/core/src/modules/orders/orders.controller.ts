import { orderRequestSchema, type OrderRequest } from '@bolsa/shared';
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { zodPipe } from '../../common/zod.pipe';
import {
  ParticipantGuard,
  currentParticipant,
  type RequestWithParticipant,
} from '../participants/participant.guard';
import { OrdersService, type OrderSummary } from './orders.service';

@ApiTags('orders')
@Controller()
@UseGuards(ParticipantGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('orders')
  @ApiOperation({ summary: 'Confirma a cotacao e inicia o pagamento' })
  create(
    @Req() request: RequestWithParticipant,
    @Body(zodPipe(orderRequestSchema)) body: OrderRequest,
  ): Promise<OrderSummary> {
    return this.orders.create(currentParticipant(request), body);
  }

  @Get('me/orders')
  @ApiOperation({ summary: 'Encomendas e vouchers do participante' })
  list(@Req() request: RequestWithParticipant): Promise<OrderSummary[]> {
    return this.orders.listForParticipant(currentParticipant(request).id);
  }
}
