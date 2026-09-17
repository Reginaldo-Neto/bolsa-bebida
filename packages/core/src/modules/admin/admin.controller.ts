import {
  DomainError,
  REPORT_TYPES,
  eventActionSchema,
  priceOverrideSchema,
  productCreateSchema,
  productUpdateSchema,
  refundSchema,
  stockAdjustSchema,
  type EventAction,
  type ProductInput,
  type ReportType,
} from '@bolsa/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { zodPipe } from '../../common/zod.pipe';
import type { AuditLog } from '@bolsa/db';
import { AuditService } from '../audit/audit.service';
import { AdminOnly, StaffGuard, currentStaff, type RequestWithStaff } from '../auth/staff.guard';
import { MarketService } from '../market/market.service';
import { AdminService } from './admin.service';
import { ReportsService } from './reports.service';

@ApiTags('admin')
@Controller('admin')
@UseGuards(StaffGuard)
@AdminOnly()
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly reports: ReportsService,
    private readonly market: MarketService,
    private readonly audit: AuditService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Vendas, receita, stock e encomendas pendentes ao vivo' })
  dashboard(@Req() request: RequestWithStaff) {
    return this.admin.metrics(currentStaff(request).eventId);
  }

  @Get('market')
  @ApiOperation({ summary: 'Estado do mercado como o participante o ve' })
  marketSnapshot(@Req() request: RequestWithStaff) {
    return this.market.snapshot(currentStaff(request).eventId);
  }

  @Post('events/state')
  @ApiOperation({ summary: 'Abre, pausa, fecha vendas, termina ou fixa precos' })
  changeState(
    @Req() request: RequestWithStaff,
    @Body(zodPipe(eventActionSchema)) body: EventAction,
  ) {
    return this.admin.changeState(currentStaff(request), body.action);
  }

  @Patch('events/engine-params')
  @ApiOperation({ summary: 'Altera parametros do motor, com efeito no tick seguinte' })
  updateEngineParams(@Req() request: RequestWithStaff, @Body() body: unknown) {
    return this.admin.updateEngineParams(currentStaff(request), body);
  }

  @Get('products')
  @ApiOperation({ summary: 'Catalogo completo' })
  products(@Req() request: RequestWithStaff) {
    return this.market.snapshot(currentStaff(request).eventId);
  }

  @Post('products')
  @ApiOperation({ summary: 'Cria um produto' })
  createProduct(
    @Req() request: RequestWithStaff,
    @Body(zodPipe(productCreateSchema)) body: ProductInput,
  ) {
    return this.admin.createProduct(currentStaff(request), body);
  }

  @Patch('products/:productId')
  @ApiOperation({ summary: 'Altera um produto' })
  updateProduct(
    @Req() request: RequestWithStaff,
    @Param('productId') productId: string,
    @Body(zodPipe(productUpdateSchema)) body: Partial<ProductInput>,
  ) {
    return this.admin.updateProduct(currentStaff(request), productId, body);
  }

  @Delete('products/:productId')
  @ApiOperation({ summary: 'Arquiva um produto' })
  archiveProduct(@Req() request: RequestWithStaff, @Param('productId') productId: string) {
    return this.admin.archiveProduct(currentStaff(request), productId);
  }

  @Post('products/:productId/override')
  @ApiOperation({ summary: 'Fixa o preco dentro do intervalo, por alguns ticks' })
  override(
    @Req() request: RequestWithStaff,
    @Param('productId') productId: string,
    @Body(zodPipe(priceOverrideSchema)) body: { priceCents: number; ticks: number },
  ) {
    return this.admin.overridePrice(currentStaff(request), productId, body);
  }

  @Post('products/:productId/stock-adjust')
  @ApiOperation({ summary: 'Corrige o stock, com motivo obrigatorio' })
  adjustStock(
    @Req() request: RequestWithStaff,
    @Param('productId') productId: string,
    @Body(zodPipe(stockAdjustSchema)) body: { delta: number; reason: string },
  ) {
    return this.admin.adjustStock(currentStaff(request), productId, body);
  }

  @Post('orders/:orderId/refund')
  @ApiOperation({ summary: 'Reembolsa uma encomenda' })
  refund(
    @Req() request: RequestWithStaff,
    @Param('orderId') orderId: string,
    @Body(zodPipe(refundSchema))
    body: { amountCents?: number; reason: string; restock: boolean },
  ) {
    return this.admin.refund(currentStaff(request), orderId, body);
  }

  @Get('audit')
  @ApiOperation({ summary: 'Registo de auditoria' })
  auditLog(@Req() request: RequestWithStaff): Promise<AuditLog[]> {
    return this.audit.list(currentStaff(request).eventId);
  }

  @Get('products.csv')
  @ApiOperation({ summary: 'Exporta o catalogo em CSV' })
  async exportProducts(
    @Req() request: RequestWithStaff,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', 'attachment; filename="produtos.csv"');
    return this.reports.exportProducts(currentStaff(request).eventId);
  }

  @Post('products.csv')
  @ApiOperation({ summary: 'Importa o catalogo a partir de CSV' })
  async importProducts(
    @Req() request: RequestWithStaff,
    @Body() body: { csv?: string },
  ): Promise<{ imported: number; errors: string[] }> {
    const staff = currentStaff(request);
    if (typeof body.csv !== 'string') {
      throw new DomainError('validation-failed', 'Envie o conteudo do CSV no campo "csv".');
    }

    const { products, errors } = this.reports.parseProductsCsv(body.csv);
    // Nothing is written while a line is still wrong: a half-imported price
    // list is worse than none.
    if (errors.length > 0) {
      return { imported: 0, errors };
    }

    const imported = await this.reports.importProducts(staff.eventId, products);
    await this.audit.record({
      eventId: staff.eventId,
      actorType: 'ADMIN',
      actorId: staff.id,
      action: 'products.import',
      entity: 'product',
      after: { imported },
    });

    return { imported, errors: [] };
  }

  @Get('reports/:type.csv')
  @ApiOperation({ summary: 'Vendas, precos, levantamentos ou reembolsos em CSV' })
  async report(
    @Req() request: RequestWithStaff,
    @Param('type') type: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    if (!REPORT_TYPES.includes(type as ReportType)) {
      throw new DomainError('not-found', `Relatorio desconhecido: ${type}`);
    }

    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', `attachment; filename="${type}.csv"`);
    return this.reports.report(currentStaff(request).eventId, type as ReportType);
  }
}
