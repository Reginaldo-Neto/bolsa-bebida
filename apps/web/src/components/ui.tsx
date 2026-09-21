import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useTranslation } from '../i18n';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-bg font-semibold hover:brightness-110 active:brightness-95',
  secondary: 'bg-raised text-text border border-line hover:bg-line',
  ghost: 'bg-transparent text-muted hover:text-text',
  danger: 'bg-down text-bg font-semibold hover:brightness-110',
};

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-base transition-[filter,background-color] duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</div>
  );
}

/**
 * Spec 11.1: the main action sits in the lower half of the screen, within reach
 * of a thumb, and clears the home indicator.
 */
export function StickyActions({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-line bg-bg/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-text">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-sm text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-sm text-down">
          {error}
        </span>
      )}
    </label>
  );
}

export const inputClass =
  'w-full rounded-xl border border-line bg-raised px-4 py-3 text-base text-text placeholder:text-muted';

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'error';
  children: ReactNode;
}): React.JSX.Element {
  const tones = {
    info: 'border-line bg-surface text-text',
    warning: 'border-warning/40 bg-warning/10 text-warning',
    error: 'border-down/40 bg-down/10 text-down',
  } as const;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border p-3 text-sm ${tones[tone]}`}
    >
      {children}
    </div>
  );
}

export function Spinner({ label }: { label?: string }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div role="status" className="flex items-center justify-center gap-3 py-10 text-muted">
      <span
        aria-hidden="true"
        className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent"
      />
      {label ?? t('common.loading')}
    </div>
  );
}
