import type { EventAction } from '@bolsa/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EngineParams } from '../components/engine-params';
import { SettingsToggle } from '../components/settings-toggle';
import { Alert, Button, Card, Field, Spinner, inputClass } from '../components/ui';
import { useTranslation, type TranslationKey } from '../i18n';
import { useFormatters } from '../lib/format';
import { adminApi, staffApi } from '../lib/staff-api';
import { StaffLogin } from './staff';

/** Spec 4.7: the organiser's panel. */
export function AdminApp(): React.JSX.Element {
  const { t } = useTranslation();
  const me = useQuery({ queryKey: ['staff-me'], queryFn: staffApi.me, retry: false });

  if (me.isLoading) {
    return <Spinner />;
  }
  if (me.isError) {
    return <StaffLogin role="ADMIN" />;
  }
  if (me.data?.role !== 'ADMIN') {
    return (
      <main className="mx-auto max-w-lg p-6">
        <Alert tone="error">{t('admin.noAccess')}</Alert>
      </main>
    );
  }

  return <AdminDashboard />;
}

const STATE_ACTIONS: [EventAction['action'], TranslationKey][] = [
  ['OPEN', 'admin.open'],
  ['PAUSED', 'admin.pause'],
  ['CLOSED_SALES', 'admin.closeSales'],
  ['FINISHED', 'admin.finish'],
];

function AdminDashboard(): React.JSX.Element {
  const { t } = useTranslation();
  const format = useFormatters();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const dashboard = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: adminApi.dashboard,
    refetchInterval: 5_000,
  });

  const audit = useQuery({ queryKey: ['admin-audit'], queryFn: adminApi.audit });

  const changeState = useMutation({
    mutationFn: (action: EventAction['action']) => adminApi.changeState(action),
    onSuccess: async (result) => {
      setNotice(
        t('admin.state', { status: result.status }) +
          (result.fixedPrices ? t('admin.stateFixed') : ''),
      );
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  if (dashboard.isLoading) {
    return <Spinner label={t('admin.loading')} />;
  }

  const data = dashboard.data;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
          {data && (
            <p className="text-sm text-muted">
              {data.status}
              {data.fixedPrices && t('admin.stateFixed')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <SettingsToggle compact />
          <button
            type="button"
            className="text-sm text-muted underline"
            onClick={() => {
              void staffApi.logout().then(() => queryClient.invalidateQueries());
            }}
          >
            {t('common.leave')}
          </button>
        </div>
      </header>

      {notice && (
        <div className="mt-4">
          <Alert>{notice}</Alert>
        </div>
      )}

      {/* Spec 13.3: what should make someone look up from the bar. */}
      {data && data.alerts.length > 0 && (
        <section className="mt-4 space-y-2">
          {data.alerts.map((alert) => (
            <Alert key={alert.code} tone={alert.level === 'error' ? 'error' : 'warning'}>
              {alert.message}
            </Alert>
          ))}
        </section>
      )}

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label={t('admin.revenue')} value={format.money(data?.revenueCents ?? 0)} />
        <Metric label={t('admin.units')} value={String(data?.unitsSold ?? 0)} />
        <Metric label={t('admin.pending')} value={String(data?.pendingOrders ?? 0)} />
        <Metric label={t('admin.lowStock')} value={String(data?.lowStockProducts ?? 0)} />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">
          {t('admin.eventControl')}
        </h2>
        <div className="flex flex-wrap gap-2">
          {STATE_ACTIONS.map(([action, labelKey]) => (
            <Button
              key={action}
              variant="secondary"
              disabled={changeState.isPending}
              onClick={() => changeState.mutate(action)}
            >
              {t(labelKey)}
            </Button>
          ))}
        </div>

        {/* Spec 4.1 and 12.3: the plan B if the engine ever misbehaves. */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="danger"
            disabled={changeState.isPending}
            onClick={() => changeState.mutate('FIXED_PRICES')}
          >
            {t('admin.fixedPrices')}
          </Button>
          <Button
            variant="secondary"
            disabled={changeState.isPending}
            onClick={() => changeState.mutate('RESUME_PRICES')}
          >
            {t('admin.resumePrices')}
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted">{t('admin.fixedPricesNote')}</p>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">{t('admin.drinks')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-2">{t('admin.colDrink')}</th>
                <th className="py-2 text-right">{t('admin.colQuote')}</th>
                <th className="py-2 text-right">{t('admin.colBase')}</th>
                <th className="py-2 text-right">{t('admin.colAvailable')}</th>
                <th className="py-2 text-right">{t('admin.colReserved')}</th>
                <th className="py-2 text-right">{t('admin.colSold')}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {data?.products.map((product) => (
                <ProductRow key={product.id} product={product} onDone={setNotice} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data && <EngineParams params={data.engineParams} onDone={setNotice} />}

      <section className="mt-8">
        <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">{t('admin.reports')}</h2>
        <div className="flex flex-wrap gap-2">
          {/* The label is the file that downloads, so it keeps its own name. */}
          {['vendas', 'precos', 'levantamentos', 'reembolsos'].map((type) => (
            <a
              key={type}
              href={adminApi.reportUrl(type)}
              className="min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-sm"
            >
              {type}.csv
            </a>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">{t('admin.audit')}</h2>
        <ul className="space-y-1 text-sm">
          {(audit.data ?? []).slice(0, 25).map((entry) => (
            <li key={entry.id} className="flex gap-3 border-b border-line/60 py-2">
              <span className="text-muted tabular">{format.time(entry.createdAt)}</span>
              <span className="font-medium">{entry.action}</span>
              <span className="text-muted">{entry.entity}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <Card>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-price font-bold tabular">{value}</p>
    </Card>
  );
}

function ProductRow({
  product,
  onDone,
}: {
  product: {
    id: string;
    name: string;
    priceCents: number;
    basePriceCents: number;
    stockAvailable: number;
    stockReserved: number;
    stockSold: number;
  };
  onDone: (message: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const format = useFormatters();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [priceEuros, setPriceEuros] = useState((product.priceCents / 100).toFixed(2));
  const [ticks, setTicks] = useState('3');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');

  const act = useMutation({
    mutationFn: async (kind: 'override' | 'stock') => {
      if (kind === 'override') {
        return adminApi.override(product.id, {
          priceCents: Math.round(Number(priceEuros.replace(',', '.')) * 100),
          ticks: Number(ticks),
        });
      }
      return adminApi.adjustStock(product.id, { delta: Number(delta), reason });
    },
    onSuccess: async () => {
      onDone(t('admin.updated', { name: product.name }));
      setOpen(false);
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => onDone(error.message),
  });

  return (
    <>
      <tr className="border-b border-line/60">
        <td className="py-2">{product.name}</td>
        <td className="py-2 text-right tabular">{format.money(product.priceCents)}</td>
        <td className="py-2 text-right text-muted tabular">
          {format.money(product.basePriceCents)}
        </td>
        <td className="py-2 text-right tabular">{product.stockAvailable}</td>
        <td className="py-2 text-right text-muted tabular">{product.stockReserved}</td>
        <td className="py-2 text-right text-muted tabular">{product.stockSold}</td>
        <td className="py-2 text-right">
          <button type="button" className="text-accent underline" onClick={() => setOpen(!open)}>
            {open ? t('admin.adjustClose') : t('admin.adjust')}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="pb-4">
            <div className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Field label={t('admin.pinPrice')} hint={t('admin.pinPriceHint')}>
                  <input
                    className={inputClass}
                    value={priceEuros}
                    onChange={(changeEvent) => setPriceEuros(changeEvent.target.value)}
                    inputMode="decimal"
                  />
                </Field>
                <Field label={t('admin.pinTicks')}>
                  <input
                    className={inputClass}
                    value={ticks}
                    onChange={(changeEvent) => setTicks(changeEvent.target.value)}
                    inputMode="numeric"
                  />
                </Field>
                <Button className="w-full" onClick={() => act.mutate('override')}>
                  {t('admin.pin')}
                </Button>
              </div>

              <div className="space-y-2">
                <Field label={t('admin.stockAdjust')} hint={t('admin.stockAdjustHint')}>
                  <input
                    className={inputClass}
                    value={delta}
                    onChange={(changeEvent) => setDelta(changeEvent.target.value)}
                    inputMode="numeric"
                    placeholder="24"
                  />
                </Field>
                <Field label={t('admin.reason')} hint={t('admin.reasonHint')}>
                  <input
                    className={inputClass}
                    value={reason}
                    onChange={(changeEvent) => setReason(changeEvent.target.value)}
                    placeholder={t('admin.reasonPlaceholder')}
                  />
                </Field>
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={!delta || reason.trim().length < 3}
                  onClick={() => act.mutate('stock')}
                >
                  {t('admin.adjust')}
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
