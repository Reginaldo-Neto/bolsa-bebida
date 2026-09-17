import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  randomInt,
  sign,
  verify,
} from 'node:crypto';
import {
  DomainError,
  VOUCHER_QR_PREFIX,
  VOUCHER_SHORT_CODE_ALPHABET,
  VOUCHER_SHORT_CODE_LENGTH,
} from '@bolsa/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

export interface VoucherQr {
  voucherId: string;
  eventId: string;
  signature: string;
}

/**
 * Spec 10.3: the QR is `BB1.<voucherId>.<eventId>.<signature>` with an Ed25519
 * signature over "voucherId|eventId". The private key never leaves the server;
 * the staff app carries the public key so it can reject a forged QR before it
 * even reaches the API.
 */
@Injectable()
export class VoucherSignerService {
  private readonly logger = new Logger(VoucherSignerService.name);
  private readonly privateKey: KeyObject;
  readonly publicKeyBase64: string;

  constructor(config: ConfigService<Env, true>) {
    const privatePem = config.get('VOUCHER_SIGNING_PRIVATE_KEY', { infer: true });
    const publicPem = config.get('VOUCHER_SIGNING_PUBLIC_KEY', { infer: true });

    if (privatePem && publicPem) {
      this.privateKey = createPrivateKey({
        key: Buffer.from(privatePem, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
      this.publicKeyBase64 = publicPem;
      return;
    }

    // Development only: the env schema requires real keys in production.
    // An ephemeral pair means vouchers signed before a restart stop verifying,
    // which is loud and obvious rather than silently insecure.
    const pair = generateKeyPairSync('ed25519');
    this.privateKey = pair.privateKey;
    this.publicKeyBase64 = pair.publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
    this.logger.warn(
      'A usar um par de chaves Ed25519 efemero. Os vouchers deixam de ser validos ao reiniciar.',
    );
  }

  sign(voucherId: string, eventId: string): string {
    return sign(null, payload(voucherId, eventId), this.privateKey).toString('base64url');
  }

  verify(voucherId: string, eventId: string, signature: string): boolean {
    try {
      const publicKey = createPublicKey({
        key: Buffer.from(this.publicKeyBase64, 'base64'),
        format: 'der',
        type: 'spki',
      });
      return verify(
        null,
        payload(voucherId, eventId),
        publicKey,
        Buffer.from(signature, 'base64url'),
      );
    } catch {
      return false;
    }
  }

  encodeQr(voucherId: string, eventId: string, signature: string): string {
    return [VOUCHER_QR_PREFIX, voucherId, eventId, signature].join('.');
  }

  /** Spec 6.4: an invalid QR is refused without leaking internal detail. */
  parseQr(qr: string): VoucherQr {
    const parts = qr.trim().split('.');
    const [prefix, voucherId, eventId, signature] = parts;

    if (
      parts.length !== 4 ||
      prefix !== VOUCHER_QR_PREFIX ||
      !voucherId ||
      !eventId ||
      !signature
    ) {
      throw new DomainError('voucher-invalid', 'QR Code invalido.');
    }

    return { voucherId, eventId, signature };
  }

  /** Readable fallback for when the camera will not cooperate (spec 11.3). */
  newShortCode(): string {
    let code = '';
    for (let index = 0; index < VOUCHER_SHORT_CODE_LENGTH; index += 1) {
      code += VOUCHER_SHORT_CODE_ALPHABET[randomInt(VOUCHER_SHORT_CODE_ALPHABET.length)];
    }
    return code;
  }
}

function payload(voucherId: string, eventId: string): Buffer {
  return Buffer.from(`${voucherId}|${eventId}`, 'utf8');
}
