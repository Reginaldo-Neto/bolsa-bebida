import { newId, type PrismaTransaction, type Voucher } from '@bolsa/db';
import { DomainError } from '@bolsa/shared';
import { Injectable } from '@nestjs/common';
import { VoucherSignerService } from './voucher-signer.service';

const SHORT_CODE_ATTEMPTS = 8;

@Injectable()
export class VouchersService {
  constructor(private readonly signer: VoucherSignerService) {}

  /** Spec 4.5: one voucher per paid order, with a signed QR and a short code. */
  async issue(tx: PrismaTransaction, orderId: string, eventId: string): Promise<Voucher> {
    const voucherId = newId();
    const signature = this.signer.sign(voucherId, eventId);

    for (let attempt = 0; attempt < SHORT_CODE_ATTEMPTS; attempt += 1) {
      const shortCode = this.signer.newShortCode();
      const taken = await tx.voucher.findUnique({
        where: { eventId_shortCode: { eventId, shortCode } },
        select: { id: true },
      });
      if (taken) {
        continue;
      }

      return tx.voucher.create({
        data: { id: voucherId, eventId, orderId, shortCode, signature },
      });
    }

    throw new DomainError('internal-error', 'Nao foi possivel gerar um codigo de voucher unico.');
  }

  qrFor(voucher: { id: string; eventId: string; signature: string }): string {
    return this.signer.encodeQr(voucher.id, voucher.eventId, voucher.signature);
  }
}
