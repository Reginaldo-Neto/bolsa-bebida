import { formatCents } from '@bolsa/shared';

export { formatCents };

/**
 * L3 forbids announcing reductions, so a movement is always a "variacao" and
 * always carries its sign. The arrow that goes with it lives in the component.
 */
export function formatChange(ratio: number): string {
  const percent = ratio * 100;
  if (Math.abs(percent) < 0.5) {
    return '0%';
  }
  return `${percent > 0 ? '+' : '-'}${Math.abs(percent).toFixed(0)}%`;
}

export type Direction = 'up' | 'down' | 'flat';

export function directionOf(ratio: number): Direction {
  if (Math.abs(ratio * 100) < 0.5) {
    return 'flat';
  }
  return ratio > 0 ? 'up' : 'down';
}

export function formatVolume(ml: number | null): string {
  if (!ml) {
    return '';
  }
  return ml >= 1000 ? `${(ml / 1000).toFixed(1).replace('.', ',')} L` : `${ml} ml`;
}

/** Seconds left, floored at zero, for the quote countdown (L1). */
export function secondsUntil(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}
