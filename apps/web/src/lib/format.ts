import { formatCents as formatCentsWithLocale, normalizeText } from '@bolsa/shared';
import { useMemo } from 'react';
import { useSettings, type Locale } from './settings';

/**
 * Money is always shown in euros, but not always written the same way: a
 * Portuguese reader expects "1,50 €" and an English one "€1.50". The amount
 * underneath is the same integer number of cents either way.
 */
export function formatCents(cents: number, locale: Locale = 'pt-PT'): string {
  return formatCentsWithLocale(cents, { locale });
}

/**
 * L3 forbids announcing reductions, so a movement is always a change and
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

export function formatVolume(ml: number | null, locale: Locale = 'pt-PT'): string {
  if (!ml) {
    return '';
  }
  if (ml < 1000) {
    return `${ml} ml`;
  }
  const litres = (ml / 1000).toFixed(1);
  return `${locale === 'pt-PT' ? litres.replace('.', ',') : litres} L`;
}

/** Seconds left, floored at zero, for the quote countdown (L1). */
export function secondsUntil(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

/**
 * Category names the organiser types that already mean "no alcohol".
 *
 * The comparison is against the catalogue's own wording, not the interface
 * language: the category comes from the database and does not get translated.
 */
const SOFT_DRINK_LABELS = ['sem alcool', 'nao alcoolicas', 'non-alcoholic', 'soft drinks'];

export function isSoftDrinkLabel(label: string): boolean {
  return SOFT_DRINK_LABELS.includes(normalizeText(label).trim());
}

export interface Formatters {
  money: (cents: number) => string;
  volume: (ml: number | null) => string;
  time: (iso: string) => string;
  dateTime: (date: Date) => string;
}

/** Formatters bound to the language currently on screen. */
export function useFormatters(): Formatters {
  const locale = useSettings((state) => state.locale);

  return useMemo(
    () => ({
      money: (cents: number) => formatCents(cents, locale),
      volume: (ml: number | null) => formatVolume(ml, locale),
      time: (iso: string) => new Date(iso).toLocaleTimeString(locale),
      dateTime: (date: Date) => date.toLocaleString(locale, { timeZone: 'Europe/Lisbon' }),
    }),
    [locale],
  );
}
