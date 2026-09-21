import { changeForCash, eurosToCents, type CounterPaymentMethod } from '@bolsa/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { SettingsToggle } from '../components/settings-toggle';
import { Alert, Button, Field, Spinner, inputClass } from '../components/ui';
import { useMarket } from '../hooks/use-market';
import { useTranslation } from '../i18n';
import { ApiError } from '../lib/api';
import { secondsUntil, useFormatters } from '../lib/format';
import { counterApi, staffApi, type CounterSale } from '../lib/staff-api';
import { StaffLogin } from './staff';

/**
 * Spec 11.3, extended: the till.
 *
 * Not everyone at a party pays with their phone. This is the same market, the
 * same locked price and the same voucher, operated by someone who takes notes
 * or a card on the bar's own terminal. It is used standing up, one-handed,
 * with a queue, so everything is big and there is nothing to read.
 */
export function CounterApp(): React.JSX.Element {
  const { t } = useTranslation();
  const me = useQuery({ queryKey: ['staff-me'], queryFn: staffApi.me, retry: false });

  if (me.isLoading) {
    return <Spinner />;
  }
  if (me.isError) {
    return <StaffLogin role="CASHIER" />;
  }
  if (me.data?.role !== 'CASHIER' && me.data?.role !== 'ADMIN') {
    return (
      <main className="mx-auto max-w-lg p-6">
        <Alert tone="error">{t('counter.noAccess')}</Alert>
      </main>
    );
  }

  return <Till eventId={me.data.eventId} />;
}

type Line = { productId: string; qty: number };

type Stage =
  | { kind: 'building' }
  | { kind: 'paying'; quoteId: string; totalCents: number; expiresAt: string }
  | { kind: 'sold'; receipt: CounterSale };

function Till({ eventId }: { eventId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const format = useFormatters();
  const { products, connection } = useMarket(eventId);

  const [lines, setLines] = useState<Line[]>([]);
  const [ageChecked, setAgeChecked] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'building' });

  const rows = lines.flatMap((line) => {
    const product = products.find((candidate) => candidate.id === line.productId);
    return product ? [{ line, product }] : [];
  });

  const total = rows.reduce((sum, row) => sum + row.product.priceCents * row.line.qty, 0);
  const hasAlcohol = rows.some((row) => row.product.isAlcoholic);

  const open = useMutation({
    mutationFn: () =>
      counterApi.quote({
        items: lines.map((line) => ({ productId: line.productId, qty: line.qty })),
        ageChecked,
      }),
    onSuccess: (quote) =>
      setStage({
        kind: 'paying',
        quoteId: quote.id,
        totalCents: quote.totalCents,
        expiresAt: quote.expiresAt,
      }),
  });

  function add(productId: string): void {
    setLines((current) => {
      const existing = current.find((line) => line.productId === productId);
      return existing
        ? current.map((line) =>
            line.productId === productId ? { ...line, qty: line.qty + 1 } : line,
          )
        : [...current, { productId, qty: 1 }];
    });
  }

  function remove(productId: string): void {
    setLines((current) =>
      current.flatMap((line) =>
        line.productId === productId
          ? line.qty > 1
            ? [{ ...line, qty: line.qty - 1 }]
            : []
          : [line],
      ),
    );
  }

  function reset(): void {
    setLines([]);
    setAgeChecked(false);
    open.reset();
    setStage({ kind: 'building' });
  }

  if (stage.kind === 'sold') {
    return <SaleDone receipt={stage.receipt} onNewSale={reset} />;
  }

  if (stage.kind === 'paying') {
    return (
      <Payment
        quoteId={stage.quoteId}
        totalCents={stage.totalCents}
        expiresAt={stage.expiresAt}
        onCancel={() => setStage({ kind: 'building' })}
        onSold={(receipt) => setStage({ kind: 'sold', receipt })}
      />
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-40">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('counter.title')}</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{t(`connection.${connection}`)}</span>
          <SettingsToggle compact />
        </div>
      </header>

      {/* One tap per drink. The price is whatever the market says right now. */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {products.map((product) => {
          const inSale = lines.find((line) => line.productId === product.id)?.qty ?? 0;
          const soldOut = product.stockStatus === 'SOLD_OUT';

          return (
            <button
              key={product.id}
              type="button"
              disabled={soldOut}
              onClick={() => add(product.id)}
              className={`min-h-24 rounded-2xl border p-3 text-left disabled:opacity-40 ${
                inSale > 0 ? 'border-accent bg-accent/10' : 'border-line bg-surface'
              }`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 font-semibold">{product.name}</span>
                {inSale > 0 && (
                  <span className="shrink-0 rounded-full bg-accent px-2 text-sm font-bold text-bg tabular">
                    {inSale}
                  </span>
                )}
              </span>
              <span className="mt-1 block text-price font-bold tabular">
                {format.money(product.priceCents)}
              </span>
              {soldOut && <span className="text-xs text-down">{t('counter.soldOut')}</span>}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-muted">{t('counter.empty')}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map(({ line, product }) => (
            <li
              key={product.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3"
            >
              <span className="min-w-0 flex-1 truncate">
                {line.qty}× {product.name}
              </span>
              <span className="tabular">{format.money(product.priceCents * line.qty)}</span>
              <button
                type="button"
                aria-label={t('cart.lessAria', { name: product.name })}
                onClick={() => remove(product.id)}
                className="h-11 w-11 rounded-xl border border-line bg-raised text-xl"
              >
                −
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* L5: the cashier has the customer in front of them. */}
      {hasAlcohol && (
        <label className="mt-4 flex min-h-16 items-center gap-3 rounded-2xl border-2 border-warning bg-warning/10 p-4">
          <input
            type="checkbox"
            className="h-7 w-7 shrink-0 accent-[var(--color-warning)]"
            checked={ageChecked}
            onChange={(changeEvent) => setAgeChecked(changeEvent.target.checked)}
          />
          <span>
            <span className="text-lg font-semibold text-warning">{t('counter.ageCheck')}</span>
            <span className="mt-1 block text-sm text-muted">{t('counter.ageCheckHint')}</span>
          </span>
        </label>
      )}

      {open.isError && (
        <div className="mt-4">
          <Alert tone="error">
            {open.error instanceof ApiError ? open.error.message : t('counter.failed')}
          </Alert>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-bg/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-muted">{t('common.total')}</span>
            <span className="text-price-lg font-bold tabular">{format.money(total)}</span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={rows.length === 0}
              onClick={() => {
                setLines([]);
                setAgeChecked(false);
              }}
            >
              {t('counter.clear')}
            </Button>
            <Button
              className="flex-1 py-4 text-lg"
              disabled={rows.length === 0 || (hasAlcohol && !ageChecked) || open.isPending}
              onClick={() => open.mutate()}
            >
              {open.isPending
                ? t('counter.locking')
                : t('counter.charge', { total: format.money(total) })}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * L1 applies at the till too: the price is locked while the notes are counted,
 * and the countdown is on screen. A quote that runs out is re-made at the
 * current price, exactly as it is for someone paying on their phone.
 */
function Payment({
  quoteId,
  totalCents,
  expiresAt,
  onCancel,
  onSold,
}: {
  quoteId: string;
  totalCents: number;
  expiresAt: string;
  onCancel: () => void;
  onSold: (receipt: CounterSale) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const format = useFormatters();

  const [method, setMethod] = useState<CounterPaymentMethod>('CASH');
  const [received, setReceived] = useState('');
  const [nif, setNif] = useState('');
  const [remaining, setRemaining] = useState(secondsUntil(expiresAt));

  useEffect(() => {
    const timer = setInterval(() => setRemaining(secondsUntil(expiresAt)), 250);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const receivedCents = parseEuros(received);
  const shortOfTotal = receivedCents !== null && receivedCents < totalCents;
  const changeCents =
    receivedCents !== null && !shortOfTotal ? changeForCash(totalCents, receivedCents) : null;

  const record = useMutation({
    mutationFn: () =>
      counterApi.sell({
        quoteId,
        method,
        ...(method === 'CASH' && receivedCents !== null
          ? { cashReceivedCents: receivedCents }
          : {}),
        ...(nif.trim() ? { nif: nif.trim() } : {}),
      }),
    onSuccess: onSold,
  });

  const expired = remaining <= 0;

  return (
    <main className="mx-auto max-w-lg px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-6">
      <div
        role="timer"
        aria-live="off"
        className={`rounded-2xl border p-4 text-center ${
          expired ? 'border-down/40 bg-down/10' : 'border-accent/40 bg-accent/10'
        }`}
      >
        {expired ? (
          <p className="font-semibold text-down">{t('counter.expired')}</p>
        ) : (
          <>
            <p className="text-sm text-muted">{t('counter.locked')}</p>
            <p className="text-price-lg font-bold tabular text-accent">{remaining}s</p>
          </>
        )}
      </div>

      <p className="mt-6 text-center text-muted">{t('common.total')}</p>
      <p className="text-center text-5xl font-bold tabular">{format.money(totalCents)}</p>

      {expired ? (
        <Button className="mt-8 w-full py-4 text-lg" onClick={onCancel}>
          {t('counter.reprice')}
        </Button>
      ) : (
        <>
          <h2 className="mt-8 text-sm tracking-wide text-muted uppercase">{t('counter.method')}</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(['CASH', 'CARD_TERMINAL'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={method === option}
                onClick={() => setMethod(option)}
                className={`min-h-16 rounded-2xl border text-lg font-semibold ${
                  method === option
                    ? 'border-accent bg-accent text-bg'
                    : 'border-line bg-surface text-text'
                }`}
              >
                {t(option === 'CASH' ? 'counter.methodCASH' : 'counter.methodCARD_TERMINAL')}
              </button>
            ))}
          </div>

          {method === 'CASH' ? (
            <div className="mt-4">
              <Field
                label={t('counter.received')}
                hint={t('counter.receivedHint')}
                {...(shortOfTotal ? { error: t('counter.insufficientCash') } : {})}
              >
                <input
                  className={`${inputClass} text-2xl tabular`}
                  value={received}
                  onChange={(changeEvent) => setReceived(changeEvent.target.value)}
                  inputMode="decimal"
                  placeholder="20,00"
                />
              </Field>

              {changeCents !== null && (
                <div className="mt-3 rounded-2xl border border-up/40 bg-up/10 p-4 text-center">
                  <p className="text-sm text-muted">{t('counter.change')}</p>
                  <p className="text-4xl font-bold tabular text-up">{format.money(changeCents)}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">{t('counter.cardTerminalHint')}</p>
          )}

          {/* L6: the NIF goes on the invoice, and is optional here as well. */}
          <div className="mt-4">
            <Field label={t('checkout.nif')} hint={t('checkout.nifHint')}>
              <input
                className={inputClass}
                value={nif}
                onChange={(changeEvent) => setNif(changeEvent.target.value)}
                inputMode="numeric"
                maxLength={9}
                placeholder="123456789"
              />
            </Field>
          </div>

          {record.isError && (
            <div className="mt-4">
              <Alert tone="error">
                {record.error instanceof ApiError ? record.error.message : t('counter.failed')}
              </Alert>
            </div>
          )}

          <Button
            className="mt-6 w-full py-5 text-xl"
            disabled={shortOfTotal || record.isPending}
            onClick={() => record.mutate()}
          >
            {record.isPending ? t('counter.confirming') : t('counter.confirm')}
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={onCancel}>
            {t('counter.backToSale')}
          </Button>
        </>
      )}
    </main>
  );
}

/**
 * The change first, in the largest type on the screen, because that is the one
 * number the cashier has to act on before the next person steps forward.
 *
 * The voucher is shown underneath, and can be handed over on the spot when the
 * cashier is also the one pouring, which at a small bar is the usual case.
 */
function SaleDone({
  receipt,
  onNewSale,
}: {
  receipt: CounterSale;
  onNewSale: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const format = useFormatters();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const voucher = receipt.order.voucher;

  const deliver = useMutation({
    mutationFn: () =>
      staffApi.redeem(voucher?.id ?? '', {
        items: receipt.order.items.map((item) => ({ orderItemId: item.id, qty: item.qty })),
        // L5: already confirmed when this was rung up, face to face.
        ageChecked: true,
      }),
  });

  useEffect(() => {
    if (!voucher?.qr || !canvasRef.current) {
      return;
    }
    void QRCode.toCanvas(canvasRef.current, voucher.qr, {
      width: 200,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
  }, [voucher?.qr]);

  return (
    <main className="mx-auto max-w-lg px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-6 text-center">
      <p className="text-sm tracking-wide text-up uppercase">{t('counter.sold')}</p>

      {receipt.method === 'CASH' && receipt.changeCents !== null ? (
        <div className="mt-3 rounded-3xl border-2 border-up bg-up/10 p-6">
          <p className="text-muted">{t('counter.giveChange')}</p>
          <p className="text-6xl font-bold tabular text-up">{format.money(receipt.changeCents)}</p>
        </div>
      ) : (
        <p className="mt-3 text-2xl font-semibold tabular">
          {format.money(receipt.order.totalCents)}
        </p>
      )}

      {deliver.isSuccess ? (
        <Alert tone="info">{t('counter.delivered')}</Alert>
      ) : (
        voucher && (
          <>
            <div className="mx-auto mt-6 w-fit rounded-2xl bg-white p-3">
              <canvas ref={canvasRef} aria-label={t('voucher.qrAria')} />
            </div>
            <p className="mt-2 text-price font-bold tracking-[0.2em] tabular">
              {voucher.shortCode}
            </p>
            <p className="mt-1 text-sm text-muted">{t('counter.voucherHint')}</p>

            <Button
              variant="secondary"
              className="mt-4 w-full"
              disabled={deliver.isPending}
              onClick={() => deliver.mutate()}
            >
              {deliver.isPending ? t('counter.delivering') : t('counter.deliverNow')}
            </Button>
          </>
        )
      )}

      {deliver.isError && (
        <div className="mt-4">
          <Alert tone="error">
            {deliver.error instanceof ApiError ? deliver.error.message : t('staff.deliverFailed')}
          </Alert>
        </div>
      )}

      <Button className="mt-6 w-full py-5 text-xl" onClick={onNewSale}>
        {t('counter.newSale')}
      </Button>
    </main>
  );
}

/** "20", "20,00" and "20.5" all mean the same thing to someone at a till. */
function parseEuros(input: string): number | null {
  if (!input.trim()) {
    return null;
  }
  try {
    return eurosToCents(input);
  } catch {
    return null;
  }
}
