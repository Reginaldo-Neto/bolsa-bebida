import type { MarketSnapshot } from '@bolsa/shared';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MarketService, type PricePoint } from './market.service';

@ApiTags('market')
@Controller()
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('events/:eventId/market/snapshot')
  @ApiOperation({ summary: 'Precos atuais, intervalos, stock e tick' })
  snapshot(@Param('eventId') eventId: string): Promise<MarketSnapshot> {
    return this.market.snapshot(eventId);
  }

  @Get('products/:productId/history')
  @ApiOperation({ summary: 'Historico de precos para o mini-grafico' })
  history(
    @Param('productId') productId: string,
    @Query('from') from?: string,
  ): Promise<PricePoint[]> {
    const since = from ? new Date(from) : undefined;
    return this.market.history(
      productId,
      since && !Number.isNaN(since.getTime()) ? since : undefined,
    );
  }
}
