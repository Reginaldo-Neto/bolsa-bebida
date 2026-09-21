import { nifSchema, phoneSchema, type QuoteResponse } from '@bolsa/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/chrome';
import { Alert, Button, Card, Field, Spinner, StickyActions, inputClass } from '../components/ui';
import { useTranslation } from '../i18n';
import { ApiError, api } from '../lib/api';
import { secondsUntil, useFormatters } from '../lib/format';
import { useCart } from '../lib/store';

/**
 * Spec 11.2 and L1: the quote locks the price, the countdown makes that lock
 * visible, and the amount charged is exactly the amount on this screen.
 */
export function CheckoutScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const format = useFormatters();
  const lines = useCart((state) => state.lines);
  const clear = useCart((state) => state.clear);
  const navigate = useNavigate();

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [phone, setPhone] = useState('');
  const [nif, setNif] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const createQuote = useMutation({
    mutationFn: () => api.createQuote(lines),
    onSuccess: (created) => {
      setQuote(created);
      setRemaining(secondsUntil(created.expiresAt));
    },
  });

  const createOrder = useMutation({
    mutationFn: async () => {
      const parsedPhone = phoneSchema.safeParse(phone);
      if (!parsedPhone.success) {
        throw new Error(t('checkout.phoneInvalid'));
      }
      if (nif.trim() && !nifSchema.safeParse(nif).success) {
        throw new Error(t('checkout.nifInvalid'));
      }

      const trimmedNif = nif.trim();
      return api.createOrder({
        quoteId: quote?.id ?? '',
        phone: parsedPhone.data,
        ...(trimmedNif ? { nif: trimmedNif } : {}),
      });
    },
    onSuccess: async (order) => {
      clear();
      await navigate(`/pagamento/${order.id}`);
    },
    onError: (error: Error) => setFormError(error.message),
  });

  // One quote per visit. A second one would reserve the stock twice, so the
  // ref guards against React running this effect again on a remount.
  const requested = useRef(false);
  const requestQuote = createQuote.mutate;

  useEffect(() => {
    if (requested.current) {
      return;
    }
    requested.current = true;

    if (lines.length === 0) {
      void navigate('/carrinho');
      return;
    }
    requestQuote();
  }, [lines.length, navigate, requestQuote]);

  useEffect(() => {
    if (!quote) {
      return;
    }
    const timer = setInterval(() => setRemaining(secondsUntil(quote.expiresAt)), 250);
    return () => clearInterval(timer);
  }, [quote]);

  const expired = Boolean(quote) && remaining <= 0;

  if (createQuote.isPending && !quote) {
    return <Spinner label={t('checkout.locking')} />;
  }

  if (createQuote.isError) {
    const error = createQuote.error;
    return (
      <div className="mx-auto max-w-lg p-4">
        <Alert tone="error">
          {error instanceof ApiError ? error.message : t('checkout.quoteFailed')}
        </Alert>
        <Button
          variant="secondary"
          className="mt-4 w-full"
          onClick={() => void navigate('/carrinho')}
        >
          {t('checkout.backToCart')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <AppHeader title={t('checkout.title')} />

      <main className="mx-auto max-w-lg px-4 pb-4">
        {/* L1: the lock and its remaining time, stated plainly. */}
        <div
          role="timer"
          aria-live="off"
          className={`mt-3 rounded-2xl border p-4 text-center ${
            expired ? 'border-down/40 bg-down/10' : 'border-accent/40 bg-accent/10'
          }`}
        >
          {expired ? (
            <p className="font-semibold text-down">{t('checkout.expired')}</p>
          ) : (
            <>
              <p className="text-sm text-muted">{t('checkout.lockedFor')}</p>
              <p className="text-price-lg font-bold tabular text-accent">{remaining}s</p>
              <p className="mt-1 text-sm text-muted">{t('checkout.lockedNote')}</p>
            </>
          )}
        </div>

        <Card className="mt-4">
          <ul className="space-y-2">
            {quote?.items.map((item) => (
              <li key={item.productId} className="flex justify-between gap-3 text-sm">
                <span>
                  {item.qty}× {item.name}
                </span>
                <span className="tabular">{format.money(item.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-muted">{t('common.total')}</span>
            <span className="text-price font-bold tabular">
              {format.money(quote?.totalCents ?? 0)}
            </span>
          </div>
        </Card>

        {expired ? (
          <Button
            className="mt-4 w-full"
            onClick={() => {
              setFormError(null);
              createQuote.mutate();
            }}
          >
            {t('checkout.seeCurrent')}
          </Button>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault();
              setFormError(null);
              createOrder.mutate();
            }}
          >
            <Field
              label={t('checkout.phone')}
              hint={t('checkout.phoneHint')}
              {...(formError ? { error: formError } : {})}
            >
              <input
                className={inputClass}
                value={phone}
                onChange={(changeEvent) => setPhone(changeEvent.target.value)}
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="912 345 678"
                required
              />
            </Field>

            {/* L6: the NIF is optional, and only validated if given. */}
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

            <StickyActions>
              <Button type="submit" className="w-full" disabled={createOrder.isPending}>
                {createOrder.isPending
                  ? t('checkout.sending')
                  : t('checkout.payAmount', { total: format.money(quote?.totalCents ?? 0) })}
              </Button>
            </StickyActions>
          </form>
        )}
      </main>
    </>
  );
}
