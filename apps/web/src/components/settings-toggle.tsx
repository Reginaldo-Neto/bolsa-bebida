import { useTranslation } from '../i18n';
import { useSettings } from '../lib/settings';

/**
 * Theme and language, side by side, wherever there is a header.
 *
 * Both are one tap: at a bar nobody opens a settings screen. The labels are
 * written in the language being switched *to*, so someone who cannot read the
 * current one can still find their way out.
 */
export function SettingsToggle({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useSettings((state) => state.theme);
  const locale = useSettings((state) => state.locale);
  const toggleTheme = useSettings((state) => state.toggleTheme);
  const setLocale = useSettings((state) => state.setLocale);

  const buttonClass = `inline-flex items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:text-text ${
    compact ? 'h-9 min-h-9 w-9 text-sm' : 'h-10 min-h-10 px-3 text-sm'
  }`;

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={toggleTheme}
        className={buttonClass}
        aria-label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
        title={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
      >
        <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
      </button>

      <button
        type="button"
        onClick={() => setLocale(locale === 'pt-PT' ? 'en' : 'pt-PT')}
        className={buttonClass}
        aria-label={t('locale.switch')}
        title={t('locale.switch')}
      >
        <span aria-hidden="true" className="font-semibold">
          {locale === 'pt-PT' ? 'EN' : 'PT'}
        </span>
      </button>
    </div>
  );
}
