import { newId } from '@bolsa/db';
import { DomainError, participantRoom, voucherIsRedeemable } from '@bolsa/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { StaffContext } from '../auth/auth.service';
import { EventsService } from '../events/events.service';
import { ParticipantsService } from '../participants/participants.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { VoucherSignerService } from '../vouchers/voucher-signer.service';

export interface ScannedItem {
  orderItemId: string;
  productId: string;
  name: string;
  isAlcoholic: boolean;
  qty: number;
  redeemedQty: number;
  pendingQty: number;
}

export interface ScannedVoucher {
  voucherId: string;
  shortCode: string;
  status: string;
  nickname: string;
  /** L5: staff must confirm identification before handing over alcohol. */
  requiresAgeCheck: boolean;
  items: ScannedItem[];
  /** Filled in when the voucher has already been handed over (spec 6.4). */
  lastRedemption: { at: string; pickupPoint: string | null } | null;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly signer: VoucherSignerService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
    private readonly participants: ParticipantsService,
  ) {}

  /**
   * Spec 6.3: read the QR, check the signature, and answer with what is still
   * owed. Spec 6.4: an invalid or foreign QR is refused without explaining why,
   * so a forged code teaches its author nothing.
   */
  async scan(
    staff: StaffContext,
    input: { qr?: string; shortCode?: string },
  ): Promise<ScannedVoucher> {
    await this.events.requireRedeemable(staff.eventId);

    const voucherId = input.qr ? this.voucherIdFromQr(input.qr, staff.eventId) : null;

    const voucher = await this.prisma.client.voucher.findFirst({
      where: voucherId
        ? { id: voucherId, eventId: staff.eventId }
        : { eventId: staff.eventId, shortCode: input.shortCode ?? '' },
      include: {
        order: {
          include: {
            items: { include: { product: true } },
            participant: { select: { nickname: true } },
          },
        },
        redemptions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!voucher) {
      throw new DomainError('voucher-invalid', 'Voucher invalido.');
    }
    if (input.qr && !this.signer.verify(voucher.id, voucher.eventId, voucher.signature)) {
      throw new DomainError('voucher-invalid', 'Voucher invalido.');
    }

    const items: ScannedItem[] = voucher.order.items.map((item) => ({
      orderItemId: item.id,
      productId: item.productId,
      name: item.product.name,
      isAlcoholic: item.product.isAlcoholic,
      qty: item.qty,
      redeemedQty: item.redeemedQty,
      pendingQty: item.qty - item.redeemedQty,
    }));

    const last = voucher.redemptions[0];

    return {
      voucherId: voucher.id,
      shortCode: voucher.shortCode,
      status: voucher.status,
      nickname: voucher.order.participant.nickname,
      requiresAgeCheck: items.some((item) => item.isAlcoholic && item.pendingQty > 0),
      items,
      lastRedemption: last
        ? { at: last.createdAt.toISOString(), pickupPoint: last.pickupPoint }
        : null,
    };
  }

  /**
   * Spec 6.4: the participant lost their session and cannot show a voucher.
   *
   * The specification suggests recovering it by SMS. There is no SMS provider
   * chosen yet, and at a party there is something better than one anyway: the
   * bar. The person is standing in front of the staff, which is stronger proof
   * than a code sent to a number they just typed in.
   *
   * Only staff can do this, only for their own event, and only with the phone
   * number used at payment — which is stored as a keyed hash, so this is a
   * lookup and not a way to browse other people's orders.
   */
  async findByPhone(staff: StaffContext, phone: string): Promise<ScannedVoucher[]> {
    await this.events.requireRedeemable(staff.eventId);

    const participants = await this.prisma.client.participant.findMany({
      where: {
        eventId: staff.eventId,
        phoneHash: this.participants.hashPhone(phone),
        anonymizedAt: null,
      },
      select: { orders: { select: { voucher: { select: { shortCode: true } } } } },
    });

    const shortCodes = participants
      .flatMap((participant) => participant.orders)
      .map((order) => order.voucher?.shortCode)
      .filter((code): code is string => Boolean(code));

    const vouchers: ScannedVoucher[] = [];
    for (const shortCode of shortCodes) {
      vouchers.push(await this.scan(staff, { shortCode }));
    }

    // Anything already handed over in full is noise at a busy bar.
    return vouchers.filter((voucher) => voucher.items.some((item) => item.pendingQty > 0));
  }

  /**
   * Spec 6.3 step 6: the handover is atomic. The guard is on redeemed_qty, the
   * only column that races, and the database refuses the row outright through
   * the redeemed_qty <= qty constraint if the guard were ever wrong.
   */
  async redeem(
    staff: StaffContext,
    voucherId: string,
    request: { items: { orderItemId: string; qty: number }[]; ageChecked: boolean },
  ): Promise<ScannedVoucher> {
    await this.events.requireRedeemable(staff.eventId);

    const voucher = await this.prisma.client.voucher.findFirst({
      where: { id: voucherId, eventId: staff.eventId },
      include: { order: { include: { items: { include: { product: true } } } } },
    });

    if (!voucher) {
      throw new DomainError('voucher-invalid', 'Voucher invalido.');
    }
    if (!voucherIsRedeemable(voucher.status)) {
      throw new DomainError(
        voucher.status === 'REDEEMED' ? 'voucher-already-redeemed' : 'voucher-invalid',
        voucher.status === 'REDEEMED' ? 'Este voucher ja foi levantado.' : 'Voucher invalido.',
      );
    }

    const byId = new Map(voucher.order.items.map((item) => [item.id, item]));

    // L5: alcohol never leaves the bar without the staff confirming the check.
    const handingAlcohol = request.items.some(
      (line) => byId.get(line.orderItemId)?.product.isAlcoholic,
    );
    if (handingAlcohol && !request.ageChecked) {
      throw new DomainError(
        'adult-declaration-required',
        'Confirme a verificacao de identificacao antes de entregar bebidas alcoolicas.',
      );
    }

    await this.prisma.client.$transaction(async (tx) => {
      for (const line of request.items) {
        const item = byId.get(line.orderItemId);
        if (!item) {
          throw new DomainError('voucher-invalid', 'Item nao pertence a este voucher.');
        }

        // qty is fixed once the order exists, so "redeemed + line <= qty" is
        // the same condition as "redeemed <= qty - line" and can be expressed
        // without comparing two columns.
        const claimed = await tx.orderItem.updateMany({
          where: { id: item.id, redeemedQty: { lte: item.qty - line.qty } },
          data: { redeemedQty: { increment: line.qty } },
        });

        if (claimed.count === 0) {
          throw new DomainError(
            'voucher-already-redeemed',
            `${item.product.name} ja tinha sido levantado.`,
            { orderItemId: item.id },
          );
        }

        await tx.redemption.create({
          data: {
            id: newId(),
            voucherId: voucher.id,
            orderItemId: item.id,
            qty: line.qty,
            staffUserId: staff.id,
            pickupPoint: staff.pickupPoint,
            ageChecked: request.ageChecked,
          },
        });
      }

      const items = await tx.orderItem.findMany({ where: { orderId: voucher.orderId } });
      const fullyRedeemed = items.every((item) => item.redeemedQty >= item.qty);

      await tx.voucher.update({
        where: { id: voucher.id },
        data: { status: fullyRedeemed ? 'REDEEMED' : 'PARTIALLY_REDEEMED' },
      });
      await tx.order.update({
        where: { id: voucher.orderId },
        data: { status: fullyRedeemed ? 'REDEEMED' : 'PARTIALLY_REDEEMED' },
      });
    });

    await this.audit.record({
      eventId: staff.eventId,
      actorType: 'STAFF',
      actorId: staff.id,
      action: 'voucher.redeem',
      entity: 'voucher',
      entityId: voucher.id,
      after: { items: request.items, ageChecked: request.ageChecked },
    });

    const updated = await this.scan(staff, { shortCode: voucher.shortCode });

    // Spec 6.3 step 7: the participant's phone updates while they are still at
    // the bar, so both sides see the same thing.
    this.realtime.publish(participantRoom(voucher.order.participantId), 'voucher.updated', {
      participantId: voucher.order.participantId,
      voucherId: voucher.id,
      status: updated.status,
      items: updated.items.map((item) => ({
        orderItemId: item.orderItemId,
        productId: item.productId,
        qty: item.qty,
        redeemedQty: item.redeemedQty,
      })),
    });

    return updated;
  }

  private voucherIdFromQr(qr: string, eventId: string): string {
    const parsed = this.signer.parseQr(qr);

    // Spec 6.4: a voucher from another event is refused like any other bad QR.
    if (parsed.eventId !== eventId) {
      throw new DomainError('voucher-invalid', 'Voucher invalido.');
    }
    if (!this.signer.verify(parsed.voucherId, parsed.eventId, parsed.signature)) {
      throw new DomainError('voucher-invalid', 'Voucher invalido.');
    }

    return parsed.voucherId;
  }
}
