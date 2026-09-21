import {
  redeemRequestSchema,
  voucherLookupSchema,
  voucherScanRequestSchema,
  type VoucherLookupRequest,
} from '@bolsa/shared';
import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { zodPipe } from '../../common/zod.pipe';
import { StaffGuard, currentStaff, type RequestWithStaff } from '../auth/staff.guard';
import { StaffService, type ScannedVoucher } from './staff.service';

@ApiTags('staff')
@Controller('staff')
@UseGuards(StaffGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post('vouchers/scan')
  @ApiOperation({ summary: 'Valida um QR ou codigo curto e devolve os itens por levantar' })
  scan(
    @Req() request: RequestWithStaff,
    @Body(zodPipe(voucherScanRequestSchema)) body: { qr?: string; shortCode?: string },
  ): Promise<ScannedVoucher> {
    return this.staff.scan(currentStaff(request), body);
  }

  @Post('vouchers/by-phone')
  @ApiOperation({ summary: 'Procura vouchers por telemovel, para quem perdeu a sessao' })
  findByPhone(
    @Req() request: RequestWithStaff,
    @Body(zodPipe(voucherLookupSchema)) body: VoucherLookupRequest,
  ): Promise<ScannedVoucher[]> {
    return this.staff.findByPhone(currentStaff(request), body.phone);
  }

  @Post('vouchers/:voucherId/redeem')
  @ApiOperation({ summary: 'Regista a entrega das bebidas' })
  redeem(
    @Req() request: RequestWithStaff,
    @Param('voucherId') voucherId: string,
    @Body(zodPipe(redeemRequestSchema))
    body: { items: { orderItemId: string; qty: number }[]; ageChecked: boolean },
  ): Promise<ScannedVoucher> {
    return this.staff.redeem(currentStaff(request), voucherId, body);
  }
}
