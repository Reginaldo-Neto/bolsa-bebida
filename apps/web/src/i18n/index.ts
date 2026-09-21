import { useCallback } from 'react';
import { useSettings, type Locale } from '../lib/settings';
import { en } from './en';
import { pt, type TranslationKey } from './pt';

export type { TranslationKey };
export { pt, en };

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = {
  'pt-PT': pt,
  en,
};

export type TranslationVars = Record<string, string | number>;

/**
 * Fills `{name}` placeholders. A placeholder with no value is left as written,
 * which shows up immediately in the interface instead of quietly rendering
 * "undefined" next to a price.
 */
export function translate(locale: Locale, key: TranslationKey, vars?: TranslationVars): string {
  const text = DICTIONARIES[locale][key];
  if (!vars) {
    return text;
  }

  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export type Translator = (key: TranslationKey, vars?: TranslationVars) => string;

/** The translator for the current language, and the language itself. */
export function useTranslation(): { t: Translator; locale: Locale } {
  const locale = useSettings((state) => state.locale);

  const t = useCallback<Translator>((key, vars) => translate(locale, key, vars), [locale]);

  return { t, locale };
}
