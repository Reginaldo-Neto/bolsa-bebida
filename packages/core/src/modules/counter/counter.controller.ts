import {
  counterQuoteSchema,
  counterSaleSchema,
  type CounterQuoteRequest,
  type CounterSaleRequest,
  type QuoteResponse,
} from '@bolsa/shared';
import { Body, Controller, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';
import { zodPipe } from '../../common/zod.pipe';
import { Roles, StaffGuard, currentStaff, type RequestWithStaff } from '../auth/staff.guard';
import { CounterService, type CounterSaleResult } from './counter.service';

@ApiTags('counter')
@Controller('counter')
@UseGuards(StaffGuard)
@Roles('CASHIER')
@UseInterceptors(IdempotencyInterceptor)
export class CounterController {
  constructor(private readonly counter: CounterService) {}

  @Post('quotes')
  @ApiOperation({ summary: 'Bloqueia os precos de uma venda ao balcao' })
  quote(
    @Req() request: RequestWithStaff,
    @Body(zodPipe(counterQuoteSchema)) body: CounterQuoteRequest,
  ): Promise<QuoteResponse> {
    return this.counter.quote(currentStaff(request), body);
  }

  @Post('sales')
  @ApiOperation({ summary: 'Fecha a venda recebida em numerario ou no terminal do bar' })
  sell(
    @Req() request: RequestWithStaff,
    @Body(zodPipe(counterSaleSchema)) body: CounterSaleRequest,
  ): Promise<CounterSaleResult> {
    return this.counter.sell(currentStaff(request), body);
  }
}
