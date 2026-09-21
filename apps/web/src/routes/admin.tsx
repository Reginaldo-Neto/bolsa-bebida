import type { EventAction } from '@bolsa/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Field, Spinner, inputClass } from '../components/ui';
import { formatCents } from '../lib/format';
import { adminApi, staffApi } from '../lib/staff-api';
import { StaffLogin } from './staff';

/** Spec 4.7: the organiser's panel. */
export function AdminApp(): React.JSX.Element {
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
        <Alert tone="error">Esta conta nao tem acesso a administracao.</Alert>
      </main>
    );
  }

  return <AdminDashboard />;
}

function AdminDashboard(): React.JSX.Element {
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
      setNotice(`Estado: ${result.status}${result.fixedPrices ? ' · precos fixos' : ''}`);
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  if (dashboard.isLoading) {
    return <Spinner label="A carregar o painel" />;
  }

  const data = dashboard.data;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Administracao</h1>
        <button
          type="button"
          className="text-sm text-muted underline"
          onClick={() => {
            void staffApi.logout().then(() => queryClient.invalidateQueries());
          }}
        >
          Sair
        </button>
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
        <Metric label="Receita" value={formatCents(data?.revenueCents ?? 0)} />
        <Metric label="Unidades" value={String(data?.unitsSold ?? 0)} />
        <Metric label="Pendentes" value={String(data?.pendingOrders ?? 0)} />
        <Metric label="Stock baixo" value={String(data?.lowStockProducts ?? 0)} />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">Controlo do evento</h2>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['OPEN', 'Abrir'],
              ['PAUSED', 'Pausar'],
              ['CLOSED_SALES', 'Fechar vendas'],
              ['FINISHED', 'Terminar'],
            ] as const
          ).map(([action, label]) => (
            <Button
              key={action}
              variant="secondary"
              disabled={changeState.isPending}
              onClick={() => changeState.mutate(action)}
            >
              {label}
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
            Precos fixos (emergencia)
          </Button>
          <Button
            variant="secondary"
            disabled={changeState.isPending}
            onClick={() => changeState.mutate('RESUME_PRICES')}
          >
            Retomar cotacoes
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted">
          Precos fixos devolve todas as bebidas ao preco base e para o motor. As compras continuam a
          funcionar.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">Bebidas</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-2">Bebida</th>
                <th className="py-2 text-right">Cotacao</th>
                <th className="py-2 text-right">Base</th>
                <th className="py-2 text-right">Disponivel</th>
                <th className="py-2 text-right">Reservado</th>
                <th className="py-2 text-right">Vendido</th>
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

      <section className="mt-8">
        <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">Relatorios</h2>
        <div className="flex flex-wrap gap-2">
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
        <h2 className="mb-2 text-sm tracking-wide text-muted uppercase">Auditoria</h2>
        <ul className="space-y-1 text-sm">
          {(audit.data ?? []).slice(0, 25).map((entry) => (
            <li key={entry.id} className="flex gap-3 border-b border-line/60 py-2">
              <span className="text-muted tabular">
                {new Date(entry.createdAt).toLocaleTimeString('pt-PT')}
              </span>
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
      onDone(`${product.name} atualizado.`);
      setOpen(false);
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => onDone(error.message),
  });

  return (
    <>
      <tr className="border-b border-line/60">
        <td className="py-2">{product.name}</td>
        <td className="py-2 text-right tabular">{formatCents(product.priceCents)}</td>
        <td className="py-2 text-right text-muted tabular">
          {formatCents(product.basePriceCents)}
        </td>
        <td className="py-2 text-right tabular">{product.stockAvailable}</td>
        <td className="py-2 text-right text-muted tabular">{product.stockReserved}</td>
        <td className="py-2 text-right text-muted tabular">{product.stockSold}</td>
        <td className="py-2 text-right">
          <button type="button" className="text-accent underline" onClick={() => setOpen(!open)}>
            {open ? 'Fechar' : 'Ajustar'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="pb-4">
            <div className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Field label="Fixar cotacao (EUR)" hint="Tem de estar dentro do intervalo afixado.">
                  <input
                    className={inputClass}
                    value={priceEuros}
                    onChange={(changeEvent) => setPriceEuros(changeEvent.target.value)}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Durante quantos ticks">
                  <input
                    className={inputClass}
                    value={ticks}
                    onChange={(changeEvent) => setTicks(changeEvent.target.value)}
                    inputMode="numeric"
                  />
                </Field>
                <Button className="w-full" onClick={() => act.mutate('override')}>
                  Fixar
                </Button>
              </div>

              <div className="space-y-2">
                <Field label="Ajustar stock" hint="Use um numero negativo para retirar.">
                  <input
                    className={inputClass}
                    value={delta}
                    onChange={(changeEvent) => setDelta(changeEvent.target.value)}
                    inputMode="numeric"
                    placeholder="24"
                  />
                </Field>
                <Field label="Motivo" hint="Fica registado na auditoria.">
                  <input
                    className={inputClass}
                    value={reason}
                    onChange={(changeEvent) => setReason(changeEvent.target.value)}
                    placeholder="Chegou mais um grade"
                  />
                </Field>
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={!delta || reason.trim().length < 3}
                  onClick={() => act.mutate('stock')}
                >
                  Ajustar
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
