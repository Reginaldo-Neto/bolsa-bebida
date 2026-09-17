import { Module } from '@nestjs/common';
import { VoucherSignerService } from './voucher-signer.service';
import { VouchersService } from './vouchers.service';

@Module({
  providers: [VoucherSignerService, VouchersService],
  exports: [VoucherSignerService, VouchersService],
})
export class VouchersModule {}
