import { NavLink } from 'react-router-dom';
import { useTranslation } from '../i18n';
import type { ConnectionState } from '../lib/socket';
import { useCart } from '../lib/store';
import { SettingsToggle } from './settings-toggle';

/**
 * Spec 4.8 and 11.1: the participant can always tell whether the prices on
 * screen are live. Never show an old price as if it were current.
 */
export function ConnectionBadge({ state }: { state: ConnectionState }): React.JSX.Element {
  const { t } = useTranslation();
  const live = state === 'live';

  const labels: Record<ConnectionState, string> = {
    connecting: t('connection.connecting'),
    live: t('connection.live'),
    reconnecting: t('connection.reconnecting'),
  };

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs ${
        live ? 'border-up/40 text-up' : 'border-warning/40 text-warning'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${live ? 'bg-up' : 'bg-warning animate-pulse'}`}
      />
      {labels[state]}
    </span>
  );
}

/** Spec 11.2: four tabs, thumb-reachable, at the bottom. */
export function BottomNav(): React.JSX.Element {
  const { t } = useTranslation();
  const items = useCart((state) => state.totalItems());

  const tabs = [
    { to: '/', label: t('nav.market'), icon: '📈' },
    { to: '/carrinho', label: t('nav.cart'), icon: '🛒' },
    { to: '/vouchers', label: t('nav.vouchers'), icon: '🎟️' },
    { to: '/ranking', label: t('nav.ranking'), icon: '🏆' },
  ] as const;

  return (
    <nav
      aria-label={t('nav.aria')}
      className="sticky bottom-0 z-20 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex max-w-lg">
        {tabs.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${
                  isActive ? 'text-accent' : 'text-muted'
                }`
              }
            >
              <span aria-hidden="true" className="relative text-lg">
                {tab.icon}
                {tab.to === '/carrinho' && items > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-4 rounded-full bg-accent px-1 text-[10px] font-bold text-bg">
                    {items}
                  </span>
                )}
              </span>
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppHeader({
  title,
  connection,
}: {
  title: string;
  connection?: ConnectionState;
}): React.JSX.Element {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 backdrop-blur">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
        <h1 className="min-w-0 truncate text-lg font-semibold">{title}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {connection && <ConnectionBadge state={connection} />}
          <SettingsToggle compact />
        </div>
      </div>
    </header>
  );
}
