import { DomainError, VOUCHER_SHORT_CODE_LENGTH } from '@bolsa/shared';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env';
import { VoucherSignerService } from './voucher-signer.service';

function signer(): VoucherSignerService {
  // No keys configured: the service generates an ephemeral development pair.
  return new VoucherSignerService(new ConfigService<Env, true>({} as Env));
}

const VOUCHER_ID = '0193f2a0-0000-7000-8000-000000000001';
const EVENT_ID = '0193f2a0-0000-7000-8000-000000000002';

describe('voucher signatures (spec 10.3)', () => {
  it('verifies a signature it produced', () => {
    const service = signer();
    const signature = service.sign(VOUCHER_ID, EVENT_ID);

    expect(service.verify(VOUCHER_ID, EVENT_ID, signature)).toBe(true);
  });

  it('rejects a signature bound to another voucher or another event', () => {
    const service = signer();
    const signature = service.sign(VOUCHER_ID, EVENT_ID);

    expect(service.verify('другой', EVENT_ID, signature)).toBe(false);
    expect(service.verify(VOUCHER_ID, 'outro-evento', signature)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const service = signer();
    const signature = service.sign(VOUCHER_ID, EVENT_ID);
    const tampered = `${signature.slice(0, -2)}AA`;

    expect(service.verify(VOUCHER_ID, EVENT_ID, tampered)).toBe(false);
    expect(service.verify(VOUCHER_ID, EVENT_ID, 'not-a-signature')).toBe(false);
  });

  it('cannot verify a signature made by a different server', () => {
    const signature = signer().sign(VOUCHER_ID, EVENT_ID);
    expect(signer().verify(VOUCHER_ID, EVENT_ID, signature)).toBe(false);
  });
});

describe('QR encoding', () => {
  it('round-trips through encode and parse', () => {
    const service = signer();
    const signature = service.sign(VOUCHER_ID, EVENT_ID);
    const qr = service.encodeQr(VOUCHER_ID, EVENT_ID, signature);

    expect(qr.startsWith('BB1.')).toBe(true);
    expect(service.parseQr(qr)).toEqual({
      voucherId: VOUCHER_ID,
      eventId: EVENT_ID,
      signature,
    });
  });

  it('refuses malformed input without leaking detail', () => {
    const service = signer();

    for (const bad of ['', 'nonsense', 'BB1.only.three', 'XX1.a.b.c', 'BB1.a.b.c.d']) {
      expect(() => service.parseQr(bad)).toThrow(DomainError);
      expect(() => service.parseQr(bad)).toThrow('QR Code invalido.');
    }
  });
});

describe('short codes', () => {
  it('has the configured length and avoids ambiguous characters', () => {
    const service = signer();

    for (let index = 0; index < 200; index += 1) {
      const code = service.newShortCode();
      expect(code).toHaveLength(VOUCHER_SHORT_CODE_LENGTH);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    }
  });

  it('does not repeat itself in a small sample', () => {
    const service = signer();
    const codes = new Set(Array.from({ length: 500 }, () => service.newShortCode()));

    // 32^6 possibilities: collisions in 500 draws would signal a broken RNG.
    expect(codes.size).toBeGreaterThan(495);
  });
});
